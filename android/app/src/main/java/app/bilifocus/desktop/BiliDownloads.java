package app.bilifocus.desktop;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import org.json.JSONArray;
import org.json.JSONObject;

/** Foreground-session downloads to an explicitly selected SAF directory. */
final class BiliDownloads {
    static final class Source { final String title; final List<String> urls; final Runnable check; Source(String title, List<String> urls, Runnable check) { this.title=title; this.urls=urls; this.check=check; } }
    interface Resolver { Source resolve(String bvid, String cid, String kind) throws Exception; }
    private final Context context; private final SharedPreferences preferences; private final Resolver resolver;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final List<JSONObject> jobs = new ArrayList<>();
    private JSONArray folders = new JSONArray();
    private String folder; private JSONObject active; private volatile boolean cancelled; private volatile HttpURLConnection connection;
    private boolean closed;
    private boolean loadError;
    BiliDownloads(Context context, SharedPreferences preferences, Resolver resolver) {
        this.context=context; this.preferences=preferences; this.resolver=resolver; folder=preferences.getString("downloadFolder",null);
        File staging=new File(context.getCacheDir(),"bili-download-stage"); File[] leftovers=staging.listFiles();
        if(leftovers!=null) for(File file:leftovers) if(file.isFile() && file.getName().matches("bili-[0-9]+\\.part")) file.delete();
        try {
            folders = new JSONArray(preferences.getString("saveFolders", "[]")); if (folders.length() > 30) throw new Exception();
            for (int i=0;i<folders.length();i++) {
                JSONObject item=folders.getJSONObject(i); Uri uri=Uri.parse(item.getString("location"));
                if (!item.getString("id").matches("[a-f0-9-]{36}") || !"content".equals(uri.getScheme()) || !DocumentsContract.isTreeUri(uri) || item.getString("label").length()>400) throw new Exception();
            }
            if (folder!=null) remember(Uri.parse(folder));
            JSONArray saved = new JSONArray(preferences.getString("downloadJobs","[]")); if (saved.length()>50) throw new Exception();
            for (int i=0;i<saved.length();i++) {
                JSONObject job=saved.getJSONObject(i); BiliVideoClient.bvid(job.getString("bvid")); if (!job.getString("id").matches("[a-f0-9-]{36}") || !(job.getString("kind").equals("cover") || job.getString("kind").equals("video"))) throw new Exception();
                if (job.getString("kind").equals("video")) BiliVideoClient.id(job.getString("cid"));
                if (job.getString("state").equals("running") || job.getString("state").equals("queued")) { cleanupPending(job); job.put("state","failed").put("error","App closed before completion. Retry starts again with fresh access."); }
                jobs.add(job);
            }
            save();
        } catch (Exception ignored) { jobs.clear(); loadError=true; }
    }
    synchronized JSONObject snapshot() throws Exception {
        if(loadError) throw new Exception("Saved download history could not be restored. It is preserved; downloads are paused until repair.");
        JSONArray list=new JSONArray(); for (JSONObject job:jobs) { JSONObject copy=new JSONObject(job.toString()); copy.remove("destination"); copy.remove("pendingFiles"); list.put(copy); }
        String label=null; if (folder!=null) try { label="Selected folder · " + DocumentsContract.getTreeDocumentId(Uri.parse(folder)); } catch (Exception ignored) { label="Reselect the save folder"; }
        return new JSONObject().put("folder",label==null?JSONObject.NULL:label).put("jobs",list);
    }
    private synchronized void save() { if(loadError) throw new IllegalStateException("Saved download history needs repair."); JSONArray list=new JSONArray(); for (JSONObject job:jobs) list.put(job); if (!preferences.edit().putString("downloadJobs",list.toString()).putString("saveFolders",folders.toString()).putString("downloadFolder",folder).commit()) throw new IllegalStateException("Could not save the download queue."); }
    private void remember(Uri uri) throws Exception {
        if (!"content".equals(uri.getScheme()) || !DocumentsContract.isTreeUri(uri)) throw new Exception("Select a folder.");
        for (int i=0;i<folders.length();i++) if (folders.getJSONObject(i).getString("location").equals(uri.toString())) return;
        if (folders.length()>=30) throw new Exception("Forget an old folder first (maximum 30).");
        String label=DocumentsContract.getTreeDocumentId(uri); int split=label.lastIndexOf('/'); if(split>=0) label=label.substring(split+1);
        if(label.length()>400) label=label.substring(0,400);
        folders.put(new JSONObject().put("id",UUID.randomUUID().toString()).put("label",label).put("location",uri.toString()));
    }
    synchronized JSONObject folderSnapshot() throws Exception {
        snapshot(); Object selected=JSONObject.NULL;
        for(int i=0;i<folders.length();i++) if(folders.getJSONObject(i).getString("location").equals(folder)) selected=folders.getJSONObject(i).getString("id");
        return new JSONObject().put("folders",new JSONArray(folders.toString())).put("activeFolderId",selected);
    }
    private synchronized JSONObject savedFolder(String id) throws Exception {
        snapshot(); for(int i=0;i<folders.length();i++) if(folders.getJSONObject(i).getString("id").equals(id)) return new JSONObject(folders.getJSONObject(i).toString());
        throw new Exception("Saved folder not found.");
    }
    synchronized JSONObject controlFolder(String id,String action) throws Exception {
        JSONObject item=savedFolder(id);
        if(action.equals("select")) choose(Uri.parse(item.getString("location")));
        else if(action.equals("forget")) {
            JSONArray next=new JSONArray(); for(int i=0;i<folders.length();i++) if(!folders.getJSONObject(i).getString("id").equals(id)) next.put(folders.getJSONObject(i));
            folders=next; if(item.getString("location").equals(folder)) folder=null;
            // Keep the SAF grant for downloads already queued to this destination. Never delete files.
            save();
        } else throw new Exception("Invalid folder action.");
        return folderSnapshot();
    }
    private Uri tree(String id) throws Exception { return Uri.parse(savedFolder(id).getString("location")); }
    JSONObject savedFiles(String id) throws Exception {
        Uri tree=tree(id), children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        List<JSONObject> files=new ArrayList<>(); boolean truncated=false; int scanned=0;
        String[] columns={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE,DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        try(Cursor cursor=context.getContentResolver().query(children,columns,null,null,null)) {
            if(cursor==null) throw new Exception("Folder access changed. Select it again with the system picker.");
            while(cursor.moveToNext()) {
                if(++scanned>10000) { truncated=true; break; }
                String name=cursor.getString(1),kind=DownloadFiles.mediaKind(name);
                if(kind==null || DocumentsContract.Document.MIME_TYPE_DIR.equals(cursor.getString(2))) continue;
                if(files.size()>=1000) { truncated=true; break; }
                files.add(new JSONObject().put("id",cursor.getString(0)).put("name",name).put("kind",kind).put("bytes",Math.max(0,cursor.getLong(3))).put("modifiedAt",Math.max(0,cursor.getLong(4))));
            }
        }
        files.sort((a,b)->{ int result=Long.compare(b.optLong("modifiedAt"),a.optLong("modifiedAt")); return result!=0?result:a.optString("name").compareTo(b.optString("name")); });
        JSONArray list=new JSONArray(); for(JSONObject file:files) list.put(file);
        return new JSONObject().put("folderId",id).put("files",list).put("truncated",truncated);
    }
    Intent savedFileIntent(String id,String fileId) throws Exception {
        if(fileId==null || fileId.length()>4096) throw new Exception("Choose a video or cover from this folder.");
        Uri tree=tree(id),children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree)); int scanned=0;
        try(Cursor cursor=context.getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)) {
            if(cursor!=null) while(cursor.moveToNext() && ++scanned<=10000) {
                String name=cursor.getString(1);
                if(fileId.equals(cursor.getString(0)) && DownloadFiles.mediaKind(name)!=null && !DocumentsContract.Document.MIME_TYPE_DIR.equals(cursor.getString(2))) {
                    return new Intent(Intent.ACTION_VIEW).setDataAndType(DocumentsContract.buildDocumentUriUsingTree(tree,fileId),DownloadFiles.mediaMime(name)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                }
            }
        }
        throw new Exception("Choose a video or cover from this folder.");
    }
    synchronized void choose(Uri uri) throws Exception {
        snapshot();
        if (!"content".equals(uri.getScheme()) || !DocumentsContract.isTreeUri(uri)) throw new Exception("Select a folder.");
        Uri root=DocumentsContract.buildDocumentUriUsingTree(uri,DocumentsContract.getTreeDocumentId(uri));
        try (Cursor cursor=context.getContentResolver().query(root,new String[]{DocumentsContract.Document.COLUMN_FLAGS},null,null,null)) {
            if (cursor==null || !cursor.moveToFirst() || (cursor.getInt(0)&DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE)==0) throw new Exception("This folder cannot create files.");
        }
        remember(uri); folder=uri.toString(); save();
    }
    synchronized JSONObject start(String bvid,String cid,String kind) throws Exception {
        snapshot();
        BiliVideoClient.bvid(bvid); if (!(kind.equals("video") || kind.equals("cover"))) throw new Exception("Choose video or cover."); if (kind.equals("video")) BiliVideoClient.id(cid); else cid=null;
        if (folder==null) throw new Exception("Choose a save folder in Options first."); if (jobs.size()>=50) throw new Exception("Remove old queue entries first (maximum 50).");
        for (JSONObject job:jobs) if (job.getString("bvid").equals(bvid) && Objects.equals(job.optString("cid",null),cid) && job.getString("kind").equals(kind) && (job.getString("state").equals("queued") || job.getString("state").equals("running"))) throw new Exception("This item is already queued.");
        JSONObject job=new JSONObject().put("id",UUID.randomUUID().toString()).put("bvid",bvid).put("cid",cid==null?JSONObject.NULL:cid).put("kind",kind).put("title",bvid).put("state","queued").put("downloadedBytes",0).put("totalBytes",JSONObject.NULL).put("files",new JSONArray()).put("error",JSONObject.NULL).put("createdAt",System.currentTimeMillis()).put("destination",folder).put("pendingFiles",new JSONArray());
        jobs.add(0,job); save(); pump(); return snapshot();
    }
    synchronized JSONObject control(String id,String action) throws Exception {
        snapshot();
        JSONObject job=null; for (JSONObject value:jobs) if (value.getString("id").equals(id)) job=value; if (job==null) throw new Exception("Queue item not found."); String state=job.getString("state");
        if (action.equals("cancel") && (state.equals("queued") || state.equals("running"))) { job.put("state","cancelled"); if (active==job) { cancelled=true; if (connection!=null) connection.disconnect(); } }
        else if (action.equals("retry") && (state.equals("failed") || state.equals("cancelled"))) { if (active==job) throw new Exception("Wait for cancellation to finish."); if (folder==null) throw new Exception("Choose a folder first."); job.put("state","queued").put("destination",folder).put("error",JSONObject.NULL).put("downloadedBytes",0).put("totalBytes",JSONObject.NULL); }
        else if (action.equals("remove") && !state.equals("queued") && !state.equals("running") && active!=job) jobs.remove(job);
        else throw new Exception("This queue action is unavailable."); save(); pump(); return snapshot();
    }
    synchronized void cancelPending() {
        cancelled=true; if (connection!=null) connection.disconnect();
        for (JSONObject job:jobs) if (job.optString("state").equals("queued") || job.optString("state").equals("running")) try { job.put("state","cancelled").put("error","Account changed. Retry explicitly to use current access."); } catch (Exception ignored) {}
        try { save(); } catch(Exception ignored) {}
    }
    synchronized void close() { closed=true; cancelled=true; if (connection!=null) connection.disconnect(); worker.shutdownNow(); }
    private synchronized void pump() {
        if (active!=null || closed) return;
        for (int i=jobs.size()-1;i>=0;i--) if (jobs.get(i).optString("state").equals("queued")) { active=jobs.get(i); cancelled=false; JSONObject job=active; try { job.put("state","running"); save(); } catch (Exception ignored) {} worker.execute(() -> run(job)); return; }
    }
    private void check(Source source) throws Exception { if (cancelled || closed) throw new Exception("Download cancelled."); if (source!=null) source.check.run(); }
    private String display(Uri uri) { try (Cursor cursor=context.getContentResolver().query(uri,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)) { return cursor!=null && cursor.moveToFirst()?cursor.getString(0):""; } catch(Exception ignored) { return ""; } }
    private void cleanupPending(JSONObject job) {
        JSONArray pending=job.optJSONArray("pendingFiles"); if (pending==null) return;
        for (int i=0;i<pending.length();i++) try { Uri uri=Uri.parse(pending.getString(i)); if (display(uri).matches("\\.bili-[a-f0-9-]{36}\\.part(?:\\.(mp4|webm|jpg|png|webp|gif))?")) DocumentsContract.deleteDocument(context.getContentResolver(),uri); } catch (Exception ignored) {}
        try { job.put("pendingFiles",new JSONArray()); } catch (Exception ignored) {}
    }
    private void run(JSONObject job) {
        List<File> stages=new ArrayList<>(); List<Uri> created=new ArrayList<>(); List<String> names=new ArrayList<>(), extensions=new ArrayList<>();
        try {
            check(null); Source source=resolver.resolve(job.getString("bvid"),job.optString("cid",null),job.getString("kind")); check(source);
            synchronized(this) { job.put("title",source.title); }
            File staging=new File(context.getCacheDir(),"bili-download-stage"); if (!staging.isDirectory() && !staging.mkdirs()) throw new Exception();
            for (int index=0;index<source.urls.size();index++) {
                check(source); HttpURLConnection current=(HttpURLConnection)new URL(source.urls.get(index)).openConnection(); connection=current;
                try {
                    current.setInstanceFollowRedirects(false); current.setConnectTimeout(20000); current.setReadTimeout(30000); current.setRequestProperty("Referer","https://www.bilibili.com/"); current.setRequestProperty("User-Agent","Mozilla/5.0"); current.setRequestProperty("Accept-Encoding","identity");
                    if (current.getResponseCode()!=200) throw new Exception(); long length=Long.parseLong(current.getHeaderField("Content-Length")); long limit=job.getString("kind").equals("video")?2147483648L:20971520L;
                    if (length<=0 || length>limit || staging.getUsableSpace()<length+1048576) throw new Exception();
                    synchronized(this) { job.put("totalBytes",job.optLong("totalBytes",0)+length); }
                    File file=File.createTempFile("bili-",".part",staging); stages.add(file); ByteArrayOutputStream first=new ByteArrayOutputStream(); long read=0;
                    try (InputStream input=current.getInputStream(); FileOutputStream output=new FileOutputStream(file)) {
                        byte[] buffer=new byte[65536]; int count;
                        while ((count=input.read(buffer))!=-1) { check(source); if (count==0) continue; read+=count; if (read>length) throw new Exception(); if (first.size()<32) first.write(buffer,0,Math.min(count,32-first.size())); output.write(buffer,0,count); synchronized(this) { job.put("downloadedBytes",job.optLong("downloadedBytes")+count); } }
                        check(source); if (read!=length) throw new Exception(); output.getFD().sync();
                    }
                    String extension=DownloadFiles.type(first.toByteArray(),job.getString("kind")), mime=current.getContentType(); if (mime==null || !(mime.split(";")[0].trim().equals(DownloadFiles.mime(extension)) || mime.split(";")[0].trim().equals("application/octet-stream"))) throw new Exception(); extensions.add(extension);
                    names.add(DownloadFiles.name(source.title)+"-"+job.getString("bvid")+(job.getString("kind").equals("cover")?"-cover":"-"+job.getString("cid"))+(source.urls.size()>1?"-segment"+(index+1):"")+"-"+UUID.randomUUID().toString().substring(0,8)+"."+extension);
                } finally { current.disconnect(); connection=null; }
            }
            Uri tree=Uri.parse(job.getString("destination")), root=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree)); JSONArray files=new JSONArray();
            for (int i=0;i<stages.size();i++) {
                check(source); Uri temporary=DocumentsContract.createDocument(context.getContentResolver(),root,DownloadFiles.mime(extensions.get(i)),".bili-"+UUID.randomUUID()+".part"); if (temporary==null) throw new Exception(); created.add(temporary);
                synchronized(this) { job.getJSONArray("pendingFiles").put(temporary.toString()); save(); }
                try (InputStream input=new FileInputStream(stages.get(i)); OutputStream output=context.getContentResolver().openOutputStream(temporary,"w")) { if(output==null) throw new Exception(); byte[] buffer=new byte[65536]; int count; while((count=input.read(buffer))!=-1) { check(source); output.write(buffer,0,count); } output.flush(); }
                check(source); try (Cursor cursor=context.getContentResolver().query(temporary,new String[]{DocumentsContract.Document.COLUMN_SIZE},null,null,null)) { if(cursor!=null && cursor.moveToFirst() && !cursor.isNull(0) && cursor.getLong(0)!=stages.get(i).length()) throw new Exception(); }
                Uri finalFile=DocumentsContract.renameDocument(context.getContentResolver(),temporary,names.get(i)); if(finalFile==null) throw new Exception(); created.set(created.size()-1,finalFile); files.put(display(finalFile));
            }
            check(source); synchronized(this) { if(cancelled || closed || !job.optString("state").equals("running")) throw new Exception(); job.put("files",files).put("state","completed").put("error",JSONObject.NULL).put("pendingFiles",new JSONArray()); save(); }
        } catch(Exception ignored) {
            for (Uri uri:created) try { DocumentsContract.deleteDocument(context.getContentResolver(),uri); } catch(Exception cleanup) {}
            synchronized(this) { try { job.put("state",cancelled || job.optString("state").equals("cancelled")?"cancelled":"failed").put("error","Download stopped. Check access, free space and folder permission, then retry from start.").put("files",new JSONArray()).put("pendingFiles",new JSONArray()); } catch(Exception invalid) {} }
        } finally {
            for(File file:stages) if(file.exists()) file.delete(); synchronized(this) { active=null; try { save(); } catch(Exception ignored) {} pump(); }
        }
    }
}
