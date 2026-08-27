import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { AppleSignInButton } from '@/src/components/AppleSignInButton';

export default function Signup() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit() {
    setErr(null);
    if (!email || !password) { setErr('Email and password required'); return; }
    if (password.length < 6) { setErr('Password must be at least 6 characters'); return; }
    try {
      setLoading(true);
      await signUp(email.trim(), password, name.trim() || undefined);
      router.replace('/(tabs)');
    } catch (e: any) {
      setErr(e.message || 'Signup failed');
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
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.sub}>Start uploading tax documents and let TaxPilot handle the rest.</Text>

          <AppleSignInButton onError={setErr} onStart={() => setLoading(true)} onEnd={() => setLoading(false)} />

          <Text style={styles.label}>Full name (optional)</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Jane Doe" placeholderTextColor={THEME.onSurfaceTertiary} testID="name-input" />
          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@company.com" autoCapitalize="none" keyboardType="email-address" placeholderTextColor={THEME.onSurfaceTertiary} testID="email-input" />
          <Text style={styles.label}>Password</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="At least 6 characters" secureTextEntry placeholderTextColor={THEME.onSurfaceTertiary} testID="password-input" />

          {err && <Text style={styles.err} testID="signup-error">{err}</Text>}

          <Pressable style={styles.submit} onPress={onSubmit} disabled={loading} testID="signup-submit-button">
            {loading ? <ActivityIndicator color={THEME.onBrandPrimary} /> : <Text style={styles.submitText}>Create account</Text>}
          </Pressable>

          <Pressable onPress={() => router.replace('/(auth)/login')} style={{ marginTop: SPACING.lg, alignItems: 'center' }}>
            <Text style={styles.linkText}>Already have an account? <Text style={{ color: THEME.brandPrimary, fontWeight: '700' }}>Sign in</Text></Text>
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
  sub: { fontSize: 14, color: THEME.onSurfaceTertiary, marginBottom: SPACING.xl, lineHeight: 20 },
  label: { fontSize: 13, color: THEME.onSurfaceTertiary, marginBottom: SPACING.sm, marginTop: SPACING.sm, fontWeight: '500' },
  input: { backgroundColor: THEME.surfaceSecondary, borderWidth: 1, borderColor: THEME.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, fontSize: 15, color: THEME.onSurface },
  err: { color: THEME.error, marginTop: SPACING.md, fontSize: 13 },
  submit: { backgroundColor: THEME.brandPrimary, paddingVertical: SPACING.lg, borderRadius: RADIUS.md, alignItems: 'center', marginTop: SPACING.xl },
  submitText: { color: THEME.onBrandPrimary, fontSize: 16, fontWeight: '600' },
  linkText: { color: THEME.onSurfaceTertiary, fontSize: 14 },
});
