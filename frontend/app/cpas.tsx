import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type CPA = {
  cpa_id: string;
  name: string;
  firm: string;
  email: string;
  phone: string;
  license_state: string;
  license_number: string;
  credentials: string[];
  specialties: string[];
};

export default function CPAs() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [cpas, setCpas] = useState<CPA[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async (query = '') => {
    try {
      const [r, prefs] = await Promise.all([
        api<{ cpas: CPA[] }>(`/cpas?q=${encodeURIComponent(query)}`),
        api<{ cpa_email: string | null }>('/preferences'),
      ]);
      setCpas(r.cpas); setSelectedEmail(prefs.cpa_email);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(q); }, [load, q]));

  async function pick(email: string) {
    setSaving(email);
    try {
      await api('/preferences', { method: 'POST', body: JSON.stringify({ cpa_email: email }) });
      setSelectedEmail(email);
    } catch {}
    setSaving(null);
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="cpas-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
        </Pressable>
        <Text style={styles.title}>CPA directory</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={THEME.onSurfaceTertiary} />
        <TextInput
          style={styles.search}
          placeholder="Search by name, firm, state, specialty…"
          placeholderTextColor={THEME.onSurfaceTertiary}
          value={q}
          onChangeText={setQ}
          testID="cpa-search-input"
        />
        {q ? (
          <Pressable onPress={() => setQ('')} testID="clear-search">
            <Ionicons name="close-circle" size={16} color={THEME.onSurfaceTertiary} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={THEME.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={cpas}
          keyExtractor={c => c.cpa_id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
          ListEmptyComponent={<Text style={styles.empty}>No matches. Try a different search.</Text>}
          renderItem={({ item }) => {
            const isSel = selectedEmail === item.email;
            return (
              <View style={[styles.card, isSel && styles.cardSel]} testID={`cpa-${item.cpa_id}`}>
                <View style={styles.cardTop}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{item.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.firm}>{item.firm}</Text>
                  </View>
                  {isSel && (
                    <View style={styles.selPill}>
                      <Ionicons name="checkmark" size={12} color={THEME.onBrandPrimary} />
                      <Text style={styles.selPillText}>Selected</Text>
                    </View>
                  )}
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="ribbon" size={12} color={THEME.brandPrimary} />
                  <Text style={styles.metaText}>{item.credentials.join(' · ')} · {item.license_state} {item.license_number}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="star" size={12} color={THEME.brandPrimary} />
                  <Text style={styles.metaText}>{item.specialties.join(' · ')}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="mail" size={12} color={THEME.brandPrimary} />
                  <Text style={styles.metaText}>{item.email}</Text>
                </View>
                <Pressable
                  style={[styles.pickBtn, isSel && styles.pickBtnSel]}
                  onPress={() => pick(item.email)}
                  disabled={saving === item.email || isSel}
                  testID={`pick-${item.cpa_id}`}
                >
                  {saving === item.email ? <ActivityIndicator color={THEME.onBrandPrimary} /> : (
                    <Text style={[styles.pickBtnText, isSel && styles.pickBtnTextSel]}>{isSel ? 'Current preparer' : 'Set as my preparer'}</Text>
                  )}
                </Pressable>
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, marginBottom: SPACING.md },
  search: { flex: 1, fontSize: 14, color: THEME.onSurface },
  list: { padding: SPACING.lg, paddingTop: 0, paddingBottom: 40 },
  empty: { textAlign: 'center', color: THEME.onSurfaceTertiary, marginTop: 40 },
  card: { padding: SPACING.lg, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, gap: SPACING.xs },
  cardSel: { borderColor: THEME.brandPrimary, borderWidth: 2 },
  cardTop: { flexDirection: 'row', gap: SPACING.md, alignItems: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: THEME.brandPrimary, fontWeight: '700', fontSize: 14 },
  name: { fontSize: 15, fontWeight: '700', color: THEME.onSurface },
  firm: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 2 },
  selPill: { flexDirection: 'row', gap: 4, alignItems: 'center', paddingHorizontal: SPACING.sm, paddingVertical: 3, backgroundColor: THEME.brandPrimary, borderRadius: RADIUS.pill },
  selPillText: { color: THEME.onBrandPrimary, fontSize: 11, fontWeight: '700' },
  metaRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 4 },
  metaText: { flex: 1, fontSize: 12, color: THEME.onSurface },
  pickBtn: { marginTop: SPACING.sm, paddingVertical: SPACING.sm, backgroundColor: THEME.brandPrimary, borderRadius: RADIUS.md, alignItems: 'center' },
  pickBtnSel: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.brandPrimary },
  pickBtnText: { color: THEME.onBrandPrimary, fontWeight: '600', fontSize: 13 },
  pickBtnTextSel: { color: THEME.brandPrimary },
});
