import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type Citation = { source: string; note?: string };
type ChatAnswer = {
  answer: string;
  citations: Citation[];
  requires_review: boolean;
  risk_tier: 'low' | 'medium' | 'high';
  missing_facts: string[];
  refusal: string | null;
  tax_year?: number;
};

type Turn = { role: 'user' | 'ai'; text?: string; ai?: ChatAnswer };

export default function Chat() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [taxYear, setTaxYear] = useState<number>(2025);
  const [turns, setTurns] = useState<Turn[]>([
    { role: 'ai', ai: {
      answer: "Hi — I'm the TaxPilot assistant. I answer only from IRS publications and form instructions I can cite. If your question needs facts I don't have, I'll tell you what to gather instead of guessing.",
      citations: [], requires_review: false, risk_tier: 'low', missing_facts: [], refusal: null,
    }},
  ]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    api<{ tax_year: number }>('/preferences').then(p => setTaxYear(p.tax_year)).catch(() => {});
  }, []);

  async function send() {
    const msg = input.trim();
    if (!msg || loading) return;
    setTurns(t => [...t, { role: 'user', text: msg }]);
    setInput('');
    setLoading(true);
    try {
      const r = await api<ChatAnswer>('/chat', { method: 'POST', body: JSON.stringify({ message: msg, tax_year: taxYear }) });
      setTurns(t => [...t, { role: 'ai', ai: r }]);
    } catch (e: any) {
      setTurns(t => [...t, { role: 'ai', ai: { answer: e.message || 'Assistant unavailable.', citations: [], requires_review: true, risk_tier: 'high', missing_facts: [], refusal: 'error' } }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="chat-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tax Assistant</Text>
          <Text style={styles.subtitle}>Tax Year {taxYear} · Source-grounded · refuses without authority</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {turns.map((t, i) => t.role === 'user' ? (
            <View key={i} style={[styles.bubble, styles.userBubble]} testID={`turn-user-${i}`}>
              <Text style={styles.userText}>{t.text}</Text>
            </View>
          ) : (
            <View key={i} style={[styles.bubble, styles.aiBubble]} testID={`turn-ai-${i}`}>
              <Text style={styles.aiText}>{t.ai?.answer}</Text>
              {t.ai?.refusal && (
                <View style={styles.refusalRow}>
                  <Ionicons name="ban" size={12} color={THEME.error} />
                  <Text style={styles.refusalText}>Refused: {t.ai.refusal}</Text>
                </View>
              )}
              {t.ai?.missing_facts && t.ai.missing_facts.length > 0 && (
                <View style={styles.missingBox}>
                  <Text style={styles.missingLabel}>Facts I need:</Text>
                  {t.ai.missing_facts.map((f, j) => (
                    <Text key={j} style={styles.missingItem}>• {f}</Text>
                  ))}
                </View>
              )}
              {t.ai?.citations && t.ai.citations.length > 0 && (
                <View style={styles.citations}>
                  <Text style={styles.citationsLabel}>Citations</Text>
                  {t.ai.citations.map((c, j) => (
                    <View key={j} style={styles.citation}>
                      <Ionicons name="book" size={12} color={THEME.brandPrimary} />
                      <Text style={styles.citationText}>{c.source}{c.note ? ` — ${c.note}` : ''}</Text>
                    </View>
                  ))}
                </View>
              )}
              {t.ai && (
                <View style={styles.footerRow}>
                  <View style={[styles.tierPill, { backgroundColor: (t.ai.risk_tier === 'high' ? THEME.error : t.ai.risk_tier === 'medium' ? THEME.warning : THEME.brandPrimary) + '22' }]}>
                    <Text style={[styles.tierText, { color: t.ai.risk_tier === 'high' ? THEME.error : t.ai.risk_tier === 'medium' ? THEME.warning : THEME.brandPrimary }]}>{t.ai.risk_tier} risk</Text>
                  </View>
                  {t.ai.requires_review && (
                    <View style={styles.reviewFlag}>
                      <Ionicons name="warning" size={11} color={THEME.warning} />
                      <Text style={styles.reviewFlagText}>Human review recommended</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          ))}
          {loading && (
            <View style={[styles.bubble, styles.aiBubble]}>
              <ActivityIndicator color={THEME.brandPrimary} />
            </View>
          )}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask a tax question…"
            placeholderTextColor={THEME.onSurfaceTertiary}
            multiline
            testID="chat-input"
          />
          <Pressable style={[styles.sendBtn, !input.trim() && { opacity: 0.4 }]} onPress={send} disabled={!input.trim() || loading} testID="chat-send">
            <Ionicons name="arrow-up" size={18} color={THEME.onBrandPrimary} />
          </Pressable>
        </View>
        <Text style={styles.disclaimer}>Not legal or tax advice. For material items, consult a qualified tax professional.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: THEME.border },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: THEME.onSurface },
  subtitle: { fontSize: 11, color: THEME.onSurfaceTertiary, marginTop: 1 },
  thread: { padding: SPACING.lg, gap: SPACING.md },
  bubble: { padding: SPACING.md, borderRadius: RADIUS.md, maxWidth: '90%' },
  userBubble: { alignSelf: 'flex-end', backgroundColor: THEME.brandPrimary },
  userText: { color: THEME.onBrandPrimary, fontSize: 14 },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: THEME.surfaceSecondary, borderWidth: 1, borderColor: THEME.border, width: '100%' },
  aiText: { color: THEME.onSurface, fontSize: 14, lineHeight: 20 },
  refusalRow: { flexDirection: 'row', gap: 4, alignItems: 'center', marginTop: SPACING.sm },
  refusalText: { fontSize: 11, color: THEME.error, fontWeight: '600' },
  missingBox: { marginTop: SPACING.md, padding: SPACING.sm, backgroundColor: THEME.warning + '18', borderRadius: RADIUS.sm },
  missingLabel: { fontSize: 11, fontWeight: '700', color: THEME.warning, letterSpacing: 0.5, marginBottom: 4 },
  missingItem: { fontSize: 12, color: THEME.onSurface, lineHeight: 18 },
  citations: { marginTop: SPACING.md, padding: SPACING.sm, backgroundColor: THEME.brandTertiary, borderRadius: RADIUS.sm, gap: 4 },
  citationsLabel: { fontSize: 11, fontWeight: '700', color: THEME.brandPrimary, letterSpacing: 0.5, marginBottom: 2 },
  citation: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  citationText: { flex: 1, fontSize: 12, color: THEME.onSurface },
  footerRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md, alignItems: 'center' },
  tierPill: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.pill },
  tierText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  reviewFlag: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  reviewFlagText: { fontSize: 11, color: THEME.warning, fontWeight: '600' },
  inputBar: { flexDirection: 'row', gap: SPACING.sm, padding: SPACING.md, borderTopWidth: 1, borderTopColor: THEME.border, backgroundColor: THEME.surface, alignItems: 'flex-end' },
  input: { flex: 1, maxHeight: 100, backgroundColor: THEME.surfaceSecondary, borderWidth: 1, borderColor: THEME.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, fontSize: 14, color: THEME.onSurface },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  disclaimer: { textAlign: 'center', fontSize: 10, color: THEME.onSurfaceTertiary, padding: SPACING.sm, paddingBottom: SPACING.md },
});
