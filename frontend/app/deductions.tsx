import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type Item = {
  item_id: string;
  title: string;
  description: string;
  authority: string;
  risk_tier: 'low' | 'medium' | 'high';
  detected: boolean;
  disposition?: string | null;
  disposition_at?: string | null;
};

const ACTIONS: { key: string; label: string; icon: string }[] = [
  { key: 'review', label: 'Review', icon: 'reader' },
  { key: 'not_applicable', label: 'Not applicable', icon: 'close-circle' },
  { key: 'need_help', label: 'Need help', icon: 'help-circle' },
  { key: 'save_for_pro_review', label: 'Save for pro review', icon: 'bookmark' },
];

const DISP_LABEL: Record<string, string> = {
  review: 'Marked for review',
  not_applicable: 'Not applicable',
  need_help: 'Help requested',
  save_for_pro_review: 'Saved for professional review',
};

export default function Deductions() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Item[]; disclaimer: string }>('/potential-items');
      setItems(r.items); setDisclaimer(r.disclaimer);
    } catch {}
    setLoading(false); setRefreshing(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function setDisposition(itemId: string, disposition: string) {
    try {
      await api(`/potential-items/${itemId}/disposition`, { method: 'POST', body: JSON.stringify({ disposition }) });
      setItems(prev => prev.map(i => i.item_id === itemId ? { ...i, disposition } : i));
    } catch {}
  }

  const [handoffBusy, setHandoffBusy] = useState<string | null>(null);
  async function generateHandoff(itemId: string) {
    try {
      setHandoffBusy(itemId);
      const r = await api<{ filename: string; pdf_base64: string; cpa_email: string | null }>(`/handoff/${itemId}/pdf`, { method: 'POST' });
      if (Platform.OS === 'web') {
        // Trigger browser download
        const bin = atob(r.pdf_base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = r.filename; a.click();
        URL.revokeObjectURL(url);
      } else {
        const path = (FileSystem as any).cacheDirectory + r.filename;
        await FileSystem.writeAsStringAsync(path, r.pdf_base64, { encoding: 'base64' as any });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Send to your CPA' });
        }
      }
    } catch (e) {
      // swallow — user cancel or share unavailable
    } finally {
      setHandoffBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="deductions-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
        </Pressable>
        <Text style={styles.title}>Potential items</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={THEME.brandPrimary} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.item_id}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={THEME.brandPrimary} />}
          ListHeaderComponent={
            <View style={styles.disclaimerCard} testID="disclaimer-banner">
              <Ionicons name="information-circle" size={18} color={THEME.warning} />
              <Text style={styles.disclaimerText}>{disclaimer}</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
          renderItem={({ item }) => {
            const open = expanded === item.item_id;
            const tierColor = item.risk_tier === 'high' ? THEME.error : item.risk_tier === 'medium' ? THEME.warning : THEME.brandPrimary;
            return (
              <View style={[styles.card, !item.detected && styles.cardDim]} testID={`potential-${item.item_id}`}>
                <Pressable onPress={() => setExpanded(open ? null : item.item_id)} style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.badgeRow}>
                      {item.detected ? (
                        <View style={[styles.badge, { backgroundColor: THEME.brandTertiary }]}>
                          <Text style={[styles.badgeText, { color: THEME.brandPrimary }]}>Detected</Text>
                        </View>
                      ) : (
                        <View style={[styles.badge, { backgroundColor: THEME.border }]}>
                          <Text style={[styles.badgeText, { color: THEME.onSurfaceTertiary }]}>Not detected</Text>
                        </View>
                      )}
                      <View style={[styles.badge, { backgroundColor: tierColor + '22' }]}>
                        <Text style={[styles.badgeText, { color: tierColor }]}>{item.risk_tier} risk</Text>
                      </View>
                    </View>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.cardAuthority}>Authority: {item.authority}</Text>
                  </View>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={THEME.onSurfaceTertiary} />
                </Pressable>

                {open && (
                  <View style={styles.cardBody}>
                    <Text style={styles.desc}>{item.description}</Text>

                    <Text style={styles.noteWarn}>
                      Detection does NOT confirm eligibility. Review the authority and required facts before taking any action.
                    </Text>

                    <View style={styles.actionsGrid}>
                      {ACTIONS.map(a => (
                        <Pressable
                          key={a.key}
                          style={[styles.actionBtn, item.disposition === a.key && styles.actionBtnActive]}
                          onPress={() => setDisposition(item.item_id, a.key)}
                          testID={`disp-${item.item_id}-${a.key}`}
                        >
                          <Ionicons name={a.icon as any} size={14} color={item.disposition === a.key ? THEME.onBrandPrimary : THEME.brandPrimary} />
                          <Text style={[styles.actionText, item.disposition === a.key && { color: THEME.onBrandPrimary }]}>{a.label}</Text>
                        </Pressable>
                      ))}
                    </View>

                    {item.disposition && (
                      <View style={styles.dispPill}>
                        <Ionicons name="checkmark" size={12} color={THEME.brandPrimary} />
                        <Text style={styles.dispText}>{DISP_LABEL[item.disposition]}</Text>
                      </View>
                    )}

                    {item.disposition === 'save_for_pro_review' && (
                      <Pressable style={styles.handoffBtn} onPress={() => generateHandoff(item.item_id)} disabled={handoffBusy === item.item_id} testID={`handoff-${item.item_id}`}>
                        {handoffBusy === item.item_id ? <ActivityIndicator color={THEME.onBrandPrimary} /> : (
                          <>
                            <Ionicons name="share" size={14} color={THEME.onBrandPrimary} />
                            <Text style={styles.handoffText}>Generate reviewer packet</Text>
                          </>
                        )}
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: THEME.onSurface },
  disclaimerCard: { flexDirection: 'row', gap: SPACING.sm, padding: SPACING.md, backgroundColor: THEME.warning + '18', borderRadius: RADIUS.md, marginBottom: SPACING.lg },
  disclaimerText: { flex: 1, fontSize: 12, color: THEME.onSurface, lineHeight: 17 },
  card: { backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, overflow: 'hidden' },
  cardDim: { opacity: 0.55 },
  cardHead: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md, gap: SPACING.md },
  badgeRow: { flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.xs },
  badge: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.pill },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: THEME.onSurface },
  cardAuthority: { fontSize: 11, color: THEME.onSurfaceTertiary, marginTop: 2 },
  cardBody: { padding: SPACING.md, paddingTop: 0, gap: SPACING.md },
  desc: { fontSize: 13, color: THEME.onSurface, lineHeight: 19 },
  noteWarn: { fontSize: 11, color: THEME.warning, fontWeight: '600', lineHeight: 16 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  actionBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, backgroundColor: THEME.brandTertiary },
  actionBtnActive: { backgroundColor: THEME.brandPrimary },
  actionText: { fontSize: 12, fontWeight: '600', color: THEME.brandPrimary },
  dispPill: { flexDirection: 'row', gap: 4, alignSelf: 'flex-start', backgroundColor: THEME.brandTertiary, paddingHorizontal: SPACING.md, paddingVertical: 4, borderRadius: RADIUS.pill, alignItems: 'center' },
  dispText: { fontSize: 11, fontWeight: '700', color: THEME.brandPrimary },
  handoffBtn: { flexDirection: 'row', gap: SPACING.sm, backgroundColor: THEME.brandPrimary, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.sm },
  handoffText: { color: THEME.onBrandPrimary, fontSize: 13, fontWeight: '600' },
});
