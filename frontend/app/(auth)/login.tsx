import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { AppleSignInButton } from '@/src/components/AppleSignInButton';

WebBrowser.maybeCompleteAuthSession();

export default function Login() {
  const router = useRouter();
  const { signIn, exchangeSessionId } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => tryExchange(url));
    Linking.getInitialURL().then((u) => u && tryExchange(u));
    return () => sub.remove();
  }, []);

  async function tryExchange(url: string | null) {
    if (!url) return;
    const m = url.match(/[?#&]session_id=([^&#]+)/);
    if (!m) return;
    try {
      setLoading(true);
      await exchangeSessionId(decodeURIComponent(m[1]));
      router.replace('/(tabs)');
    } catch (e: any) {
      setErr(e.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function onGoogle() {
    setErr(null);
    const redirectUrl = Platform.OS === 'web' ? window.location.origin + '/' : Linking.createURL('');
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === 'web') {
      window.location.href = authUrl;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    if (result.type === 'success' && result.url) tryExchange(result.url);
  }

  async function onSubmit() {
    setErr(null);
    if (!email || !password) { setErr('Enter email and password'); return; }
    try {
      setLoading(true);
      await signIn(email.trim(), password);
      router.replace('/(tabs)');
    } catch (e: any) {
      setErr(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
            <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
          </Pressable>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.sub}>Sign in to your TaxPilot account.</Text>

          <Pressable style={styles.googleBtn} onPress={onGoogle} testID="google-signin-btn">
            <Ionicons name="logo-google" size={18} color={THEME.onSurface} />
            <Text style={styles.googleText}>Continue with Google</Text>
          </Pressable>

          <AppleSignInButton onError={setErr} onStart={() => setLoading(true)} onEnd={() => setLoading(false)} />

          <View style={styles.divider}>
            <View style={styles.line} /><Text style={styles.orText}>or</Text><View style={styles.line} />
          </View>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input} value={email} onChangeText={setEmail}
            placeholder="you@company.com" autoCapitalize="none" keyboardType="email-address"
            placeholderTextColor={THEME.onSurfaceTertiary} testID="email-input"
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input} value={password} onChangeText={setPassword}
            placeholder="••••••••" secureTextEntry placeholderTextColor={THEME.onSurfaceTertiary} testID="password-input"
          />
          {err && <Text style={styles.err} testID="login-error">{err}</Text>}

          <Pressable style={styles.submit} onPress={onSubmit} disabled={loading} testID="login-submit-button">
            {loading ? <ActivityIndicator color={THEME.onBrandPrimary} /> : <Text style={styles.submitText}>Sign in</Text>}
          </Pressable>

          <Pressable onPress={() => router.replace('/(auth)/signup')} style={{ marginTop: SPACING.lg, alignItems: 'center' }}>
            <Text style={styles.linkText}>New here? <Text style={{ color: THEME.brandPrimary, fontWeight: '700' }}>Create an account</Text></Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  content: { padding: SPACING.xl, paddingTop: SPACING.md, flexGrow: 1 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  title: { fontSize: 28, fontWeight: '700', color: THEME.onSurface, marginBottom: SPACING.xs },
  sub: { fontSize: 14, color: THEME.onSurfaceTertiary, marginBottom: SPACING.xl },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.md,
    backgroundColor: THEME.surfaceSecondary, paddingVertical: SPACING.lg, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: THEME.border, marginBottom: SPACING.lg,
  },
  googleText: { fontSize: 15, fontWeight: '600', color: THEME.onSurface },
  divider: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.lg },
  line: { flex: 1, height: 1, backgroundColor: THEME.border },
  orText: { color: THEME.onSurfaceTertiary, fontSize: 12 },
  label: { fontSize: 13, color: THEME.onSurfaceTertiary, marginBottom: SPACING.sm, marginTop: SPACING.sm, fontWeight: '500' },
  input: {
    backgroundColor: THEME.surfaceSecondary, borderWidth: 1, borderColor: THEME.border,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    fontSize: 15, color: THEME.onSurface,
  },
  err: { color: THEME.error, marginTop: SPACING.md, fontSize: 13 },
  submit: { backgroundColor: THEME.brandPrimary, paddingVertical: SPACING.lg, borderRadius: RADIUS.md, alignItems: 'center', marginTop: SPACING.xl },
  submitText: { color: THEME.onBrandPrimary, fontSize: 16, fontWeight: '600' },
  linkText: { color: THEME.onSurfaceTertiary, fontSize: 14 },
});
