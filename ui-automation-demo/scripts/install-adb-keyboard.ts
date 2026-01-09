
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

const ADB_KEYBOARD_URLS = [
  'https://raw.githubusercontent.com/senzhk/ADBKeyBoard/master/ADBKeyBoard.apk',
  'https://github.com/senzhk/ADBKeyBoard/raw/master/ADBKeyBoard.apk'
];

// Fallback manual instruction if download fails
function printManualDownloadInstructions() {
  console.error('\n' + '='.repeat(50));
  console.error('❌ Automatic download failed due to network issues.');
  console.error('Please manually download ADBKeyBoard.apk from:');
  console.error('  https://github.com/senzhk/ADBKeyBoard/raw/master/ADBKeyBoard.apk');
  console.error(`And save it to: ${APK_PATH}`);
  console.error('Then run this script again.');
  console.error('='.repeat(50) + '\n');
}

const APK_PATH = path.join(process.cwd(), 'temp', 'ADBKeyBoard.apk');

function verifyApkFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    if (stats.size < 1000) return false; // Too small

    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(2);
    fs.readSync(fd, buffer, 0, 2, 0);
    fs.closeSync(fd);
    
    if (buffer.toString() !== 'PK') {
      console.log('File is not a valid APK (magic number mismatch).');
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error verifying APK file:', e);
    return false;
  }
}

async function downloadFile(url: string, dest: string): Promise<boolean> {
  try {
    console.log(`Attempting download from: ${url}`);
    await execAsync(`curl -L -s -o "${dest}" "${url}"`);
    
    // Verify file size and magic number (PK for zip/apk)
    if (!verifyApkFile(dest)) {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      return false;
    }

    return true;
  } catch (e) {
    console.error(`Download failed from ${url}:`, e);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    return false;
  }
}

async function main() {
  try {
    // 1. Check connected devices
    const { stdout: devicesOut } = await execAsync('adb devices');
    const devices = devicesOut.split('\n')
      .filter(line => line.includes('\tdevice'))
      .map(line => line.split('\t')[0]);

    if (devices.length === 0) {
      console.error('No devices connected.');
      return;
    }
    const udid = devices[0];
    console.log(`Target device: ${udid}`);

    // 2. Check if installed
    const { stdout: packages } = await execAsync(`adb -s ${udid} shell pm list packages com.android.adbkeyboard`);
    if (packages.includes('com.android.adbkeyboard')) {
      console.log('ADBKeyBoard is already installed.');
    } else {
      console.log('ADBKeyBoard not found. Installing...');
      
      // Ensure temp dir
      if (!fs.existsSync(path.dirname(APK_PATH))) {
        fs.mkdirSync(path.dirname(APK_PATH), { recursive: true });
      }

      // Download if not exists or invalid
      let needDownload = true;
      if (fs.existsSync(APK_PATH)) {
        if (verifyApkFile(APK_PATH)) {
          console.log('Valid APK found locally.');
          needDownload = false;
        } else {
          console.log('Local APK is invalid. Deleting and re-downloading...');
          fs.unlinkSync(APK_PATH);
        }
      }

      if (needDownload) {
        let downloaded = false;
        for (const url of ADB_KEYBOARD_URLS) {
          if (await downloadFile(url, APK_PATH)) {
            downloaded = true;
            break;
          }
        }
        
        if (!downloaded) {
          printManualDownloadInstructions();
          throw new Error('Failed to download ADBKeyBoard.apk from all mirrors.');
        }
      }

      // Install
      console.log('Installing APK...');
      console.log('👉 Please check your device screen and confirm the installation if prompted!');
      await execAsync(`adb -s ${udid} install -r "${APK_PATH}"`);
      console.log('Installed successfully.');
    }

    // 3. Enable IME
    console.log('Enabling ADBKeyBoard IME...');
    await execAsync(`adb -s ${udid} shell ime enable com.android.adbkeyboard/.AdbIME`);
    await execAsync(`adb -s ${udid} shell ime set com.android.adbkeyboard/.AdbIME`);
    
    console.log('ADBKeyBoard setup complete. You can now use [ADB] prefix in input steps.');

  } catch (err) {
    console.error('Error:', err);
  }
}

main();
