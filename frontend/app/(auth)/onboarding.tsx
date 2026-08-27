import { View, Text, StyleSheet, Pressable, ImageBackground } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { THEME, SPACING, RADIUS } from '@/src/theme';

export default function Onboarding() {
  const router = useRouter();
  return (
    <View style={styles.root} testID="onboarding-screen">
      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1675251171768-5d49233cc410?crop=entropy&cs=srgb&fm=jpg&w=1200&q=80' }}
        style={styles.hero}
        imageStyle={{ resizeMode: 'cover' }}
      >
        <LinearGradient colors={['transparent', THEME.surface]} style={StyleSheet.absoluteFill} />
        <View style={styles.badge}>
          <View style={styles.dot} />
          <Text style={styles.badgeText}>Interactive demo · sample data</Text>
        </View>
      </ImageBackground>

      <SafeAreaView edges={['bottom']} style={styles.bottom}>
        <Text style={styles.brand}>TaxPilot AI</Text>
        <Text style={styles.headline}>A secure AI tax agent that turns raw documents into a filed return.</Text>
        <Text style={styles.sub}>Upload W-2s, 1099s, K-1s, and receipts. TaxPilot classifies them, extracts every figure with a confidence score, and routes anything risky to a human reviewer.</Text>

        <Pressable style={styles.primaryBtn} onPress={() => router.push('/(auth)/signup')} testID="cta-get-started">
          <Text style={styles.primaryBtnText}>Get started</Text>
          <Ionicons name="arrow-forward" size={18} color={THEME.onBrandPrimary} />
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => router.push('/(auth)/login')} testID="cta-sign-in">
          <Text style={styles.secondaryBtnText}>I already have an account</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  hero: { height: '45%', justifyContent: 'flex-start', padding: SPACING.lg },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, alignSelf: 'flex-start',
    marginTop: SPACING.xxl,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: THEME.brandPrimary },
  badgeText: { color: THEME.onSurface, fontSize: 12, fontWeight: '500' },
  bottom: { flex: 1, paddingHorizontal: SPACING.xl, paddingTop: SPACING.lg, justifyContent: 'flex-end', paddingBottom: SPACING.md },
  brand: { fontSize: 14, color: THEME.brandPrimary, fontWeight: '700', letterSpacing: 1.5, marginBottom: SPACING.md },
  headline: { fontSize: 26, color: THEME.onSurface, fontWeight: '700', lineHeight: 32, marginBottom: SPACING.md },
  sub: { fontSize: 14, color: THEME.onSurfaceTertiary, lineHeight: 20, marginBottom: SPACING.xl },
  primaryBtn: {
    backgroundColor: THEME.brandPrimary, paddingVertical: SPACING.lg, borderRadius: RADIUS.md,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md,
  },
  primaryBtnText: { color: THEME.onBrandPrimary, fontSize: 16, fontWeight: '600' },
  secondaryBtn: { paddingVertical: SPACING.md, alignItems: 'center' },
  secondaryBtnText: { color: THEME.brandPrimary, fontSize: 15, fontWeight: '600' },
});
