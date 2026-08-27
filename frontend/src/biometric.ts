import { storage } from '@/src/utils/storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

export const BIOMETRIC_ENABLED_KEY = 'tp_biometric_enabled';

export async function isBiometricSupported(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const hasHw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHw && enrolled;
  } catch { return false; }
}

export async function isBiometricEnabled(): Promise<boolean> {
  const v = await storage.getItem<boolean>(BIOMETRIC_ENABLED_KEY, false);
  return !!v;
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await storage.setItem(BIOMETRIC_ENABLED_KEY, enabled);
}

export async function authenticate(reason: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Use passcode',
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
    return r.success;
  } catch {
    return false;
  }
}
