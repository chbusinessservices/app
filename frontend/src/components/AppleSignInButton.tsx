import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth';

type Props = {
  onError?: (msg: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
};

export function AppleSignInButton({ onError, onStart, onEnd }: Props) {
  const router = useRouter();
  const { appleSignIn } = useAuth();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAvailable).catch(() => setAvailable(false));
  }, []);

  if (Platform.OS !== 'ios' || !available) return null;

  return (
    <View style={{ marginBottom: 16 }} testID="apple-signin-container">
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={12}
        style={{ width: '100%', height: 52 }}
        onPress={async () => {
          try {
            onStart?.();
            const credential = await AppleAuthentication.signInAsync({
              requestedScopes: [
                AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                AppleAuthentication.AppleAuthenticationScope.EMAIL,
              ],
            });
            if (!credential.identityToken) throw new Error('No identity token');
            const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
              .filter(Boolean).join(' ') || undefined;
            await appleSignIn(credential.identityToken, credential.email || undefined, fullName);
            router.replace('/(tabs)');
          } catch (e: any) {
            if (e?.code === 'ERR_REQUEST_CANCELED') return;
            onError?.(e?.message || 'Apple sign-in failed');
          } finally {
            onEnd?.();
          }
        }}
      />
    </View>
  );
}
