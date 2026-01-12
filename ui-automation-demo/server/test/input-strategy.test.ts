import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'node:child_process';

// Mock exec before importing the module
vi.mock('node:child_process', () => {
  return {
    exec: vi.fn(),
  };
});

import { inputViaADBKeyboard, inputViaAdbShell } from '../runner.android.js';

describe('Android Input Strategy', () => {
  const mockExec = child_process.exec as unknown as ReturnType<typeof vi.fn>;
  const udid = 'device-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('inputViaADBKeyboard', () => {
    it('should successfully input text when ADBKeyBoard is installed', async () => {
      // Mock sequence of exec calls
      mockExec.mockImplementation((cmd: string, cb: any) => {
        if (cmd.includes('pm list packages')) {
          cb(null, { stdout: 'package:com.android.adbkeyboard' });
        } else if (cmd.includes('settings get secure default_input_method')) {
          cb(null, { stdout: 'com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME' });
        } else {
          cb(null, { stdout: '' });
        }
      });

      await inputViaADBKeyboard(udid, '你好');

      // Verify key steps
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('ime enable com.android.adbkeyboard/.AdbIME'), expect.any(Function));
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('ADB_INPUT_B64'), expect.any(Function));
      // Verify restore
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('ime set com.google.android.inputmethod.latin'), expect.any(Function));
    });

    it('should throw error if ADBKeyBoard is missing', async () => {
      mockExec.mockImplementation((cmd: string, cb: any) => {
        if (cmd.includes('pm list packages')) {
          cb(null, { stdout: '' }); // Empty list
        }
      });

      await expect(inputViaADBKeyboard(udid, '你好')).rejects.toThrow('ADBKeyBoard not installed');
    });
  });

  describe('inputViaAdbShell', () => {
    it('should use adb shell input text for ASCII', async () => {
      mockExec.mockImplementation((_cmd: string, cb: any) => cb(null, { stdout: '' }));
      
      await inputViaAdbShell(udid, 'Hello World');
      
      // Expect spaces to be escaped as %s
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('input text "Hello%sWorld"'), expect.any(Function));
    });

    it('should throw error for non-ASCII characters', async () => {
        await expect(inputViaAdbShell(udid, '你好')).rejects.toThrow('Text contains non-ASCII characters');
    });
  });
});
