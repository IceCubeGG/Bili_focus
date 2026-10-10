package app.bilifocus.desktop;
import static org.junit.Assert.*;
import org.junit.Test;
public final class BiliSearchBoundaryTest {
    @Test public void acceptsKeywordsAndCanonicalBvPrefix() { assertEquals("科技 & music", BiliSearchClient.query(" 科技 & music ")); assertEquals("BV1xx411c7mD", BiliSearchClient.query("bv1xx411c7mD")); }
    @Test public void rejectsEmptyControlAndOversizedQueries() { for (Object input : new Object[]{null, 4, "", "  ", "BV1", "x\n", new String(new char[201]).replace('\0', 'a')}) assertThrows(IllegalArgumentException.class, () -> BiliSearchClient.query(input)); }
    @Test public void boundsPageIndices() { assertEquals(1,BiliSearchClient.page(null)); assertEquals(1000,BiliSearchClient.page("1000")); for(Object input:new Object[]{0,"0","01","1001","1&x=y"}) assertThrows(IllegalArgumentException.class,()->BiliSearchClient.page(input)); }
    @Test public void convertsHighlightingToPlainText() { assertEquals("科学 & 艺术",BiliSearchClient.title("<em class=\"keyword\">科学</em> &amp; 艺术")); assertEquals("🚀<b>",BiliSearchClient.title("<img onerror=\"bad()\">&#x1F680;&lt;b&gt;")); }
}
