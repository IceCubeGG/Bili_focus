package app.bilifocus.desktop;
import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.*;
import java.util.ArrayList;
@RunWith(AndroidJUnit4.class)
public final class SearchMetadataInstrumentedTest {
    private JSONObject item() throws Exception { return new JSONObject().put("type","video").put("bvid","BV1xx411c7mD").put("mid",123).put("author","Creator").put("title","<em>科学</em> &amp; 艺术").put("pic","//i0.hdslb.com/cover.jpg").put("duration","1:02:03").put("play",42).put("pubdate",1700000000); }
    @Test public void parsesDeduplicatesAndPaginatesOnlyVideos() throws Exception {
        JSONArray items = new JSONArray().put(item()).put(item()).put(new JSONObject(item().toString()).put("type","live")).put(new JSONObject(item().toString()).put("is_ad",1));
        JSONObject result=BiliSearchClient.normalize(new JSONObject().put("page",1).put("numResults",21).put("numPages",2).put("result",items),1);
        assertEquals(1,result.getJSONArray("videos").length()); assertEquals("科学 & 艺术",result.getJSONArray("videos").getJSONObject(0).getString("title")); assertEquals(3723,result.getJSONArray("videos").getJSONObject(0).getInt("durationSeconds")); assertEquals("2",result.getString("cursor"));
    }
    @Test public void keepsGuestCookiesNativeAndEncodesKeyword() throws Exception {
        ArrayList<String> endpoints=new ArrayList<>();
        BiliSearchClient client=new BiliSearchClient((endpoint,cookies)->{
            endpoints.add(endpoint);
            if(endpoint.endsWith("/spi")) return new JSONObject().put("code",0).put("data",new JSONObject().put("b_3","ISSUED-BUVID"));
            assertEquals("buvid3=ISSUED-BUVID",cookies); assertTrue(endpoint.contains("keyword=%E7%A7%91%E6%8A%80+%26+music"));
            return new JSONObject().put("code",0).put("data",new JSONObject().put("page",1).put("numResults",1).put("numPages",1).put("result",new JSONArray().put(item())));
        });
        JSONObject result=client.search("科技 & music",JSONObject.NULL,null,()->{});
        assertEquals(2,endpoints.size()); assertFalse(result.toString().contains("ISSUED")); assertFalse(result.getBoolean("hasMore"));
    }
    @Test public void verificationIsNotAnEmptySuccess() { assertThrows(Exception.class,()->BiliSearchClient.normalize(new JSONObject().put("v_voucher","challenge"),1)); }
}
