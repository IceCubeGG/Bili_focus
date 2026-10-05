import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidRoot = join(projectRoot, 'android');
const javaExecutable = process.platform === 'win32' ? 'java.exe' : 'java';
const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.platform === 'win32' && 'C:/Program Files (x86)/Android/android-sdk',
  process.platform === 'win32' && join(homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
  process.platform === 'darwin' && join(homedir(), 'Library', 'Android', 'sdk'),
  process.platform === 'linux' && join(homedir(), 'Android', 'Sdk'),
].filter(Boolean);
const sdkRoot = sdkCandidates.find(candidate => existsSync(join(candidate, 'platforms', 'android-36', 'android.jar')));
if (!sdkRoot) {
  console.error('Android SDK 36 was not found. Set ANDROID_HOME to your existing SDK folder.');
  process.exit(1);
}

const bundledJdkRoot = 'C:/Program Files/Android/openjdk';
const javaHomes = [process.env.JAVA_HOME];
if (process.platform === 'win32' && existsSync(bundledJdkRoot)) {
  javaHomes.push(...readdirSync(bundledJdkRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => join(bundledJdkRoot, entry.name)));
}
const javaCandidates = javaHomes.filter(Boolean).map(javaHome => ({
  executable: join(javaHome, 'bin', javaExecutable), javaHome,
}));
javaCandidates.push({ executable: javaExecutable, javaHome: null });
let selectedJava;
for (const candidate of javaCandidates) {
  const result = spawnSync(candidate.executable, ['-version'], { encoding: 'utf8', windowsHide: true });
  const versionText = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const major = Number(versionText.match(/(?:java|openjdk) version "(\d+)/)?.[1] ?? 0);
  if (result.status === 0 && major >= 21) {
    selectedJava = { ...candidate, version: versionText.split(/\r?\n/)[0] };
    break;
  }
}
if (!selectedJava) {
  console.error('Java 21 or newer was not found. Set JAVA_HOME to your installed JDK folder.');
  process.exit(1);
}

const buildEnvironment = { ...process.env, ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot };
if (selectedJava.javaHome) buildEnvironment.JAVA_HOME = selectedJava.javaHome;
else delete buildEnvironment.JAVA_HOME;
console.log(`Android SDK: ${sdkRoot}`);
console.log(`Java: ${selectedJava.version}`);
const instrumentation = process.argv.includes('--instrumentation');
console.log(instrumentation ? 'Building the debug APK and emulator test package…' : 'Building the debug APK and running Android account unit tests…');
const build = spawn(selectedJava.executable, [
  '-Xmx64m', '-Xms64m', '-Dorg.gradle.appname=gradlew',
  '-classpath', join(androidRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar'),
  'org.gradle.wrapper.GradleWrapperMain',
  '--gradle-user-home', process.env.GRADLE_USER_HOME || join(projectRoot, '.gradle-cache'),
  ':app:assembleDebug', ':app:testDebugUnitTest',
  ...(instrumentation ? [':app:assembleDebugAndroidTest'] : []),
  '--no-daemon', '--console=plain',
], { cwd: androidRoot, env: buildEnvironment, stdio: 'inherit', windowsHide: true });
build.on('error', error => { console.error(`Android build could not start: ${error.message}`); process.exitCode = 1; });
build.on('exit', code => {
  process.exitCode = code ?? 1;
  if (code === 0) console.log(`APK: ${join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')}`);
});
