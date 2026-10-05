package app.bilifocus.desktop;
import static org.junit.Assert.*;
import android.content.Context;
import android.content.SharedPreferences;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
@RunWith(AndroidJUnit4.class)
public class DownloadsInstrumentedTest {
    @Test public void missingFolderAndInvalidRequestsCannotFetchOrWrite() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext(); SharedPreferences preferences=context.getSharedPreferences("download-fixture-"+UUID.randomUUID(),Context.MODE_PRIVATE); AtomicInteger calls=new AtomicInteger();
        BiliDownloads downloads=new BiliDownloads(context,preferences,(bvid,cid,kind)->{calls.incrementAndGet();throw new Exception("No network allowed");});
        try { assertTrue(downloads.snapshot().isNull("folder")); assertThrows(Exception.class,()->downloads.start("BV1xx411c7mD","123","video")); assertThrows(Exception.class,()->downloads.start("https://localhost/","123","video")); assertEquals(0,calls.get()); }
        finally { downloads.close(); preferences.edit().clear().commit(); }
    }
    @Test public void interruptedQueueNeverAutomaticallyResolvesAnOldSession() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext(); SharedPreferences preferences=context.getSharedPreferences("download-fixture-"+UUID.randomUUID(),Context.MODE_PRIVATE); AtomicInteger calls=new AtomicInteger();
        JSONObject job=new JSONObject().put("id",UUID.randomUUID().toString()).put("bvid","BV1xx411c7mD").put("cid","123").put("kind","video").put("title","Fixture").put("state","running").put("files",new JSONArray()).put("pendingFiles",new JSONArray()).put("createdAt",1);
        preferences.edit().putString("downloadJobs",new JSONArray().put(job).toString()).commit(); BiliDownloads downloads=new BiliDownloads(context,preferences,(bvid,cid,kind)->{calls.incrementAndGet();throw new Exception();});
        try { assertEquals("failed",downloads.snapshot().getJSONArray("jobs").getJSONObject(0).getString("state")); assertFalse(downloads.snapshot().toString().contains("destination")); assertEquals(0,calls.get()); }
        finally { downloads.close(); preferences.edit().clear().commit(); }
    }
}
