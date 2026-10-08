import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DownloadManager } from '../src/electron/download-manager';
import type { VideoClient } from '../src/electron/video-client';
const BV = 'BV1xx411c7mD';
const mp4 = new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0]);
const cover = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const response = (bytes = mp4, mime = 'video/mp4', length = bytes.length) => new Response(bytes, { headers: { 'Content-Type': mime, 'Content-Length': String(length) } });
const directories: string[] = [];
async function setup() {
  const directory = await mkdtemp(join(tmpdir(),'bili-download-fixture-')); directories.push(directory); const folder=join(directory,'saved'); await mkdir(folder); let revision=1;
  const videos = { getVideoDetails: vi.fn(async () => ({ bvid:BV, title:'../../CON: fixture?', parts:[{cid:'123',page:1}] })), getVideoPlayback: vi.fn(async () => ({handle:'opaque',sources:[{url:'bili-media://stream/11111111-1111-4111-8111-111111111111/0'}]})), releaseVideoPlayback: vi.fn(), stream: vi.fn(async (_request:Request) => response()), coverStream: vi.fn(async () => response(cover,'image/png')) };
  const path=join(directory,'downloads.json'), manager=new DownloadManager(path,videos as unknown as VideoClient,()=>revision); await manager.load();
  return {manager,videos,path,folder,change:()=>{revision++;manager.syncAccount();}};
}
async function finished(manager:DownloadManager) { await vi.waitFor(()=>expect(manager.get().jobs.some(job=>['queued','running'].includes(job.state))).toBe(false),{timeout:3000,interval:10}); await new Promise(resolve=>setTimeout(resolve,30)); return manager.get().jobs[0]; }
afterEach(async()=>{ for(const path of directories.splice(0)) await rm(path,{recursive:true,force:true}); });
describe('native download queue',()=>{
  it('migrates the original save location and persists stable folder identifiers', async () => {
    const { manager, path, folder, videos } = await setup();
    await writeFile(path, JSON.stringify({ version: 1, folder, jobs: [] })); await manager.load();
    const before = manager.getSaveFolders(); expect(before.folders).toHaveLength(1); expect(before.activeFolderId).toBe(before.folders[0].id);
    const restored = new DownloadManager(path, videos as unknown as VideoClient, () => 1); await restored.load(); expect(restored.getSaveFolders()).toEqual(before);
  });
  it('remembers multiple folders, deduplicates selections and forgets without deleting files', async () => {
    const { manager, folder } = await setup(), second = folder + '-second'; await mkdir(second);
    await writeFile(join(folder, 'keep.mp4'), mp4); await manager.chooseFolder(folder); const first = manager.getSaveFolders().activeFolderId!;
    await manager.chooseFolder(second); await manager.chooseFolder(second); expect(manager.getSaveFolders().folders).toHaveLength(2);
    await manager.controlSaveFolder({ id: first, action: 'select' }); expect(manager.get().folder).toBe(folder);
    await manager.controlSaveFolder({ id: first, action: 'forget' }); expect(manager.get().folder).toBeNull(); expect(manager.getSaveFolders().folders).toHaveLength(1);
    expect(await readFile(join(folder, 'keep.mp4'))).toEqual(Buffer.from(mp4)); await expect(manager.start({ bvid: BV, cid: '123', kind: 'video' })).rejects.toThrow('folder');
    await expect(manager.controlSaveFolder({ id: first, action: 'select' })).rejects.toThrow('not found');
  });
  it('lists only direct supported media and rejects arbitrary paths, scripts and directories', async () => {
    const { manager, folder } = await setup(); await manager.chooseFolder(folder); const folderId = manager.getSaveFolders().activeFolderId!;
    await mkdir(join(folder, 'nested.mp4')); await writeFile(join(folder, 'nested.mp4', 'inside.mp4'), mp4);
    for (const name of ['clip.MP4', 'cover.JPEG', '.hidden.mp4', 'unfinished.part', 'script.mp4.exe', 'index.html']) await writeFile(join(folder, name), mp4);
    const listing = await manager.listSavedFiles({ folderId }); expect(listing.files.map(file => file.name).sort()).toEqual(['clip.MP4', 'cover.JPEG']); expect(listing.truncated).toBe(false); expect(listing.files.every(file => file.bytes === mp4.length)).toBe(true);
    expect(await manager.savedFilePath({ folderId, fileId: 'clip.MP4' })).toBe(join(folder, 'clip.MP4'));
    for (const fileId of ['../outside.mp4', '..\\outside.mp4', join(folder, 'clip.MP4'), 'nested.mp4', 'script.mp4.exe', 'nested.mp4/inside.mp4', 'clip.MP4:stream.mp4']) await expect(manager.savedFilePath({ folderId, fileId })).rejects.toThrow();
    await expect(manager.listSavedFiles({ folderId: folder })).rejects.toThrow('not found');
  });
  it('does not follow a directory replaced by a junction and allows forgetting an inaccessible shortcut', async () => {
    const { manager, folder } = await setup(); await manager.chooseFolder(folder); const folderId = manager.getSaveFolders().activeFolderId!;
    const other = folder + '-other'; await mkdir(other); await writeFile(join(other, 'outside.mp4'), mp4);
    await rename(folder, folder + '-moved'); await symlink(other, folder, 'junction');
    await expect(manager.listSavedFiles({ folderId })).rejects.toThrow('access changed'); await expect(manager.savedFilePath({ folderId, fileId: 'outside.mp4' })).rejects.toThrow('access changed');
    await manager.controlSaveFolder({ id: folderId, action: 'forget' }); expect(await readFile(join(other, 'outside.mp4'))).toEqual(Buffer.from(mp4));
  });
  it('keeps queued destinations pinned when the active folder changes or is forgotten', async () => {
    const { manager, videos, folder } = await setup(), second = folder + '-second'; await mkdir(second); await manager.chooseFolder(folder);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); videos.stream.mockImplementationOnce(async () => { await gate; return response(); });
    await manager.start({ bvid: BV, cid: '123', kind: 'video' }); await manager.start({ bvid: BV, cid: null, kind: 'cover' });
    await manager.chooseFolder(second); await manager.controlSaveFolder({ id: manager.getSaveFolders().activeFolderId!, action: 'forget' }); release(); await finished(manager);
    expect(manager.get().jobs.every(job => job.state === 'completed' && job.files.every(file => file.startsWith(folder + '\\')))).toBe(true);
    expect(await readdir(second)).toEqual([]); expect(manager.get().folder).toBeNull();
  });
  it('explicitly flags large folders rather than silently omitting files', async () => {
    const { manager, folder } = await setup(); await manager.chooseFolder(folder);
    await Promise.all(Array.from({ length: 1001 }, (_, index) => writeFile(join(folder, `${index}.mp4`), mp4)));
    const listing = await manager.listSavedFiles({ folderId: manager.getSaveFolders().activeFolderId! }); expect(listing.files).toHaveLength(1000); expect(listing.truncated).toBe(true);
  });
  it('preserves corrupt queue data without stopping other app features',async()=>{const {manager,path,folder,change}=await setup();await writeFile(path,'CORRUPT ORIGINAL');await expect(manager.load()).rejects.toThrow('preserved');change();await expect(manager.chooseFolder(folder)).rejects.toThrow('preserved');expect(await readFile(path,'utf8')).toBe('CORRUPT ORIGINAL');});
  it('saves separate numbered segments rather than concatenating incompatible containers',async()=>{const {manager,videos,folder}=await setup();await manager.chooseFolder(folder);videos.getVideoPlayback.mockResolvedValueOnce({handle:'opaque',sources:[{url:'bili-media://stream/11111111-1111-4111-8111-111111111111/0'},{url:'bili-media://stream/11111111-1111-4111-8111-111111111111/1'}]});await manager.start({bvid:BV,cid:'123',kind:'video'});const job=await finished(manager);expect(job.state).toBe('completed');expect(job.files).toHaveLength(2);expect(job.files[0]).toContain('-segment1-');expect(job.files[1]).toContain('-segment2-');});
  it('requires an explicitly chosen native folder',async()=>{const {manager}=await setup();await expect(manager.start({bvid:BV,cid:'123',kind:'video'})).rejects.toThrow('folder');await expect(manager.chooseFolder('relative')).rejects.toThrow();});
  it('writes validated video and cover without exposing sources or replacing existing files',async()=>{const {manager,videos,folder,path}=await setup();await writeFile(join(folder,'keep.mp4'),'USER FILE');await manager.chooseFolder(folder);await manager.start({bvid:BV,cid:'123',kind:'video'});const video=await finished(manager);expect(video.state).toBe('completed');expect(await readFile(video.files[0])).toEqual(Buffer.from(mp4));await manager.start({bvid:BV,cid:null,kind:'cover'});const image=await finished(manager);expect(image.state).toBe('completed');expect(image.files[0]).toMatch(/\.png$/);expect(await readFile(join(folder,'keep.mp4'),'utf8')).toBe('USER FILE');expect((await readdir(folder)).some(name=>name.endsWith('.part'))).toBe(false);expect(await readFile(path,'utf8')).not.toMatch(/bili-media|bilivideo|SESSDATA|secret/);expect(videos.releaseVideoPlayback).toHaveBeenCalledWith({handle:'opaque'});await manager.control({id:video.id,action:'remove'});expect(await readFile(video.files[0])).toEqual(Buffer.from(mp4));});
  it.each(['bad magic','short body','too large','mime mismatch'])('fails %s and cleans only its staging files',async(which)=>{const {manager,videos,folder}=await setup();await manager.chooseFolder(folder);videos.stream.mockResolvedValueOnce(which==='bad magic'?response(new TextEncoder().encode('<html>error</html>')):which==='short body'?response(mp4,'video/mp4',99):which==='too large'?response(mp4,'video/mp4',2147483649):response(mp4,'text/html'));await manager.start({bvid:BV,cid:'123',kind:'video'});expect((await finished(manager)).state).toBe('failed');expect(await readdir(folder)).toEqual([]);});
  it('retries only explicitly and resolves fresh sources',async()=>{const {manager,videos,folder}=await setup();await manager.chooseFolder(folder);videos.stream.mockResolvedValueOnce(response(new Uint8Array([1,2,3])));await manager.start({bvid:BV,cid:'123',kind:'video'});const failed=await finished(manager);expect(failed.state).toBe('failed');await manager.control({id:failed.id,action:'retry'});expect((await finished(manager)).state).toBe('completed');expect(videos.getVideoPlayback).toHaveBeenCalledTimes(2);});
  it('cancels active and queued jobs on an account change without completing files',async()=>{const {manager,videos,folder,change}=await setup();await manager.chooseFolder(folder);videos.stream.mockImplementationOnce(async request=>new Response(new ReadableStream({start(target){target.enqueue(mp4);request.signal.addEventListener('abort',()=>target.error(new Error('aborted')));}}),{headers:{'Content-Type':'video/mp4','Content-Length':'100'}}));await manager.start({bvid:BV,cid:'123',kind:'video'});await vi.waitFor(()=>expect(manager.get().jobs[0].downloadedBytes).toBeGreaterThan(0));await expect(manager.start({bvid:BV,cid:'123',kind:'video'})).rejects.toThrow('already queued');await manager.start({bvid:BV,cid:null,kind:'cover'});change();await finished(manager);expect(manager.get().jobs.every(job=>job.state==='cancelled')).toBe(true);expect(await readdir(folder)).toEqual([]);});
  it('restores interrupted jobs as failed without automatically fetching',async()=>{const {manager,videos,folder,path}=await setup();await writeFile(path,JSON.stringify({version:1,folder,jobs:[{id:'11111111-1111-4111-8111-111111111111',bvid:BV,cid:'123',kind:'video',title:'Interrupted',state:'running',files:[],createdAt:1}]}));await manager.load();expect(manager.get().jobs[0].state).toBe('failed');expect(videos.getVideoPlayback).not.toHaveBeenCalled();});
});
