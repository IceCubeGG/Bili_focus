package app.bilifocus.desktop;
import static org.junit.Assert.*;
import org.junit.Test;
public class DownloadFilesTest {
    @Test public void namesCannotContainPathsOrReservedWindowsNames() { assertEquals("video",DownloadFiles.name("CON")); assertEquals("video",DownloadFiles.name("NUL.txt")); assertFalse(DownloadFiles.name("../title:a?\\x").contains("/")); assertEquals(70,DownloadFiles.name(new String(new char[100]).replace('\0','a')).length()); }
    @Test public void videosAndCoversRequireMatchingMagic() throws Exception { assertEquals("mp4",DownloadFiles.type(new byte[]{0,0,0,24,102,116,121,112,105,115,111,109},"video")); assertEquals("webm",DownloadFiles.type(new byte[]{26,69,(byte)223,(byte)163},"video")); assertEquals("jpg",DownloadFiles.type(new byte[]{(byte)255,(byte)216,(byte)255},"cover")); assertThrows(Exception.class,()->DownloadFiles.type("<svg />".getBytes(),"cover")); }
}
