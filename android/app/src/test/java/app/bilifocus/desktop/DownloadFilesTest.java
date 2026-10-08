package app.bilifocus.desktop;
import static org.junit.Assert.*;
import org.junit.Test;
public class DownloadFilesTest {
    @Test public void libraryShowsOnlySupportedMediaAndNeverPartialOrExecutableFiles() {
        assertEquals("video",DownloadFiles.mediaKind("视频.MP4")); assertEquals("video",DownloadFiles.mediaKind("clip.webm")); assertEquals("cover",DownloadFiles.mediaKind("cover.JPEG"));
        assertEquals("image/jpeg",DownloadFiles.mediaMime("cover.JPEG")); assertEquals("video/webm",DownloadFiles.mediaMime("clip.webm"));
        for(String name:new String[]{".hidden.mp4",".bili-temporary.part.mp4","video.mp4.exe","index.html","unfinished.part","file.svg"}) assertNull(DownloadFiles.mediaKind(name));
    }
    @Test public void namesCannotContainPathsOrReservedWindowsNames() { assertEquals("video",DownloadFiles.name("CON")); assertEquals("video",DownloadFiles.name("NUL.txt")); assertFalse(DownloadFiles.name("../title:a?\\x").contains("/")); assertEquals(70,DownloadFiles.name(new String(new char[100]).replace('\0','a')).length()); }
    @Test public void videosAndCoversRequireMatchingMagic() throws Exception { assertEquals("mp4",DownloadFiles.type(new byte[]{0,0,0,24,102,116,121,112,105,115,111,109},"video")); assertEquals("webm",DownloadFiles.type(new byte[]{26,69,(byte)223,(byte)163},"video")); assertEquals("jpg",DownloadFiles.type(new byte[]{(byte)255,(byte)216,(byte)255},"cover")); assertThrows(Exception.class,()->DownloadFiles.type("<svg />".getBytes(),"cover")); }
}
