import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

async function verifyADBInputUsage() {
  console.log('🔍 Starting verification for ADB Input usage...');

  try {
    // 1. Get connected device
    const { stdout: devicesOut } = await execAsync('adb devices');
    const devices = devicesOut.split('\n')
      .filter(line => line.includes('\tdevice'))
      .map(line => line.split('\t')[0]);

    if (devices.length === 0) {
      console.error('❌ No devices connected. Please connect a device.');
      return;
    }
    const udid = devices[0];
    console.log(`📱 Device detected: ${udid}`);

    // 2. Check if ADBKeyBoard is installed
    const { stdout: listPackages } = await execAsync(`adb -s ${udid} shell pm list packages com.android.adbkeyboard`);
    if (!listPackages.includes('com.android.adbkeyboard')) {
      console.error('❌ ADBKeyBoard is NOT installed.');
      console.log('💡 Run `npx tsx scripts/install-adb-keyboard.ts` to install it.');
      return;
    }
    console.log('✅ ADBKeyBoard package found.');

    // 3. Check current Input Method
    const { stdout: imeOut } = await execAsync(`adb -s ${udid} shell settings get secure default_input_method`);
    console.log(`⌨️  Current default Input Method: ${imeOut.trim()}`);
    
    if (imeOut.includes('com.android.adbkeyboard/.AdbIME')) {
      console.log('✅ ADBKeyBoard is currently set as default.');
    } else {
      console.warn('⚠️  ADBKeyBoard is NOT the default input method.');
      console.log('   (Note: The runner script automatically switches this during execution, so this might be expected if no test is running currently.)');
    }

    // 4. Test Input Execution
    console.log('\n🧪 Testing input execution...');
    console.log('   Please focus on a text input field on your device screen NOW.');
    console.log('   Sending text "Hello_ADB_World" in 3 seconds...');
    
    await new Promise(r => setTimeout(r, 3000));

    // Switch IME just in case
    await execAsync(`adb -s ${udid} shell ime enable com.android.adbkeyboard/.AdbIME`);
    await execAsync(`adb -s ${udid} shell ime set com.android.adbkeyboard/.AdbIME`);
    
    // Send Broadcast
    const text = "Hello_ADB_World";
    const b64 = Buffer.from(text).toString('base64');
    const cmd = `adb -s ${udid} shell am broadcast -a ADB_INPUT_B64 --es msg "${b64}"`;
    
    console.log(`   Running command: ${cmd}`);
    await execAsync(cmd);
    
    console.log('\n✅ Broadcast sent successfully.');
    console.log('👀 Check your device screen. Did "Hello_ADB_World" appear?');
    console.log('   If yes, your setup is correct and ADBKeyBoard is being called.');

  } catch (err) {
    console.error('❌ Verification failed:', err);
  }
}

verifyADBInputUsage();
