import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type Taxpayer = { taxpayer_id: string; name: string; relationship: string; notes: string | null; created_at: string };
type Prefs = { active_taxpayer_id: string | null };

const RELATIONS: { key: string; label: string; icon: string }[] = [
  { key: 'spouse', label: 'Spouse', icon: 'heart' },
  { key: 'dependent', label: 'Dependent', icon: 'people' },
  { key: 'business', label: 'Business entity', icon: 'business' },
  { key: 'other', label: 'Other', icon: 'person' },
];

const REL_ICON: Record<string, string> = { self: 'person-circle', spouse: 'heart', dependent: 'people', business: 'business', other: 'person' };

export default function Taxpayers() {
  const router = useRouter();
  const [items, setItems] = useState<Taxpayer[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRel, setNewRel] = useState('spouse');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, prefs] = await Promise.all([
        api<Taxpayer[]>('/taxpayers'),
        api<Prefs>('/preferences'),
      ]);
      setItems(list); setActiveId(prefs.active_taxpayer_id);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function activate(id: string) {
    setBusy(id);
    try {
      await api(`/taxpayers/${id}/activate`, { method: 'POST' });
      setActiveId(id);
    } catch {}
    setBusy(null);
  }

  async function create() {
    if (!newName.trim()) return;
    setBusy('_create');
    try {
      await api('/taxpayers', { method: 'POST', body: JSON.stringify({ name: newName.trim(), relationship: newRel }) });
      setNewName(''); setNewRel('spouse'); setAddOpen(false);
      await load();
    } catch {}
    setBusy(null);
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await api(`/taxpayers/${id}`, { method: 'DELETE' });
      await load();
    } catch {}
    setBusy(null);
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="taxpayers-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
        </Pressable>
        <Text style={styles.title}>Taxpayers</Text>
        <Pressable style={styles.addBtn} onPress={() => setAddOpen(true)} testID="add-taxpayer-btn">
          <Ionicons name="add" size={22} color={THEME.onBrandPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={THEME.brandPrimary} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.taxpayer_id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
          ListHeaderComponent={
            <View style={styles.infoCard}>
              <Ionicons name="information-circle" size={18} color={THEME.brandPrimary} />
              <Text style={styles.infoText}>Each taxpayer has isolated documents, review queue, consent, and pipeline. Switch context here or from the dashboard.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isActive = activeId === item.taxpayer_id;
            return (
              <View style={[styles.card, isActive && styles.cardActive]} testID={`taxpayer-${item.taxpayer_id}`}>
                <View style={styles.cardTop}>
                  <View style={[styles.icon, isActive && styles.iconActive]}>
                    <Ionicons name={(REL_ICON[item.relationship] || 'person') as any} size={22} color={isActive ? THEME.onBrandPrimary : THEME.brandPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.rel}>{item.relationship}</Text>
                  </View>
                  {isActive && (
                    <View style={styles.activePill}>
                      <Text style={styles.activePillText}>Active</Text>
                    </View>
                  )}
                </View>
                <View style={styles.actions}>
                  {!isActive && (
                    <Pressable style={styles.actBtn} onPress={() => activate(item.taxpayer_id)} disabled={busy === item.taxpayer_id} testID={`activate-${item.taxpayer_id}`}>
                      {busy === item.taxpayer_id ? <ActivityIndicator color={THEME.onBrandPrimary} /> : (
                        <>
                          <Ionicons name="swap-horizontal" size={14} color={THEME.onBrandPrimary} />
                          <Text style={styles.actBtnText}>Switch to</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                  {item.relationship !== 'self' && (
                    <Pressable style={styles.removeBtn} onPress={() => remove(item.taxpayer_id)} disabled={busy === item.taxpayer_id} testID={`remove-${item.taxpayer_id}`}>
                      <Ionicons name="trash" size={14} color={THEME.error} />
                    </Pressable>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}

      <Modal transparent visible={addOpen} animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => setAddOpen(false)}>
            <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
              <Text style={styles.modalTitle}>Add taxpayer</Text>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Sam Doe"
                placeholderTextColor={THEME.onSurfaceTertiary}
                autoCapitalize="words"
                testID="new-taxpayer-name"
              />
              <Text style={styles.label}>Relationship</Text>
              <View style={styles.relRow}>
                {RELATIONS.map(r => (
                  <Pressable key={r.key} style={[styles.relChip, newRel === r.key && styles.relChipActive]} onPress={() => setNewRel(r.key)} testID={`new-rel-${r.key}`}>
                    <Ionicons name={r.icon as any} size={14} color={newRel === r.key ? THEME.onBrandPrimary : THEME.brandPrimary} />
                    <Text style={[styles.relChipText, newRel === r.key && { color: THEME.onBrandPrimary }]}>{r.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={[styles.createBtn, !newName.trim() && { opacity: 0.5 }]} onPress={create} disabled={!newName.trim() || busy === '_create'} testID="create-taxpayer-btn">
                {busy === '_create' ? <ActivityIndicator color={THEME.onBrandPrimary} /> : <Text style={styles.createBtnText}>Create</Text>}
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: THEME.onSurface },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  list: { padding: SPACING.lg, paddingBottom: 40 },
  infoCard: { flexDirection: 'row', gap: SPACING.sm, padding: SPACING.md, backgroundColor: THEME.brandTertiary, borderRadius: RADIUS.md, marginBottom: SPACING.md, alignItems: 'flex-start' },
  infoText: { flex: 1, fontSize: 12, color: THEME.onSurface, lineHeight: 17 },
  card: { padding: SPACING.lg, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border, gap: SPACING.md },
  cardActive: { borderColor: THEME.brandPrimary, borderWidth: 2 },
  cardTop: { flexDirection: 'row', gap: SPACING.md, alignItems: 'center' },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  iconActive: { backgroundColor: THEME.brandPrimary },
  name: { fontSize: 15, fontWeight: '700', color: THEME.onSurface },
  rel: { fontSize: 11, color: THEME.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  activePill: { backgroundColor: THEME.brandPrimary, paddingHorizontal: SPACING.sm, paddingVertical: 3, borderRadius: RADIUS.pill },
  activePillText: { color: THEME.onBrandPrimary, fontSize: 11, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  actBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: THEME.brandPrimary },
  actBtnText: { color: THEME.onBrandPrimary, fontSize: 13, fontWeight: '600' },
  removeBtn: { width: 44, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: THEME.error + '55', backgroundColor: THEME.surface },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: THEME.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.xl, gap: SPACING.sm },
  modalTitle: { fontSize: 20, fontWeight: '700', color: THEME.onSurface, marginBottom: SPACING.sm },
  label: { fontSize: 12, fontWeight: '700', color: THEME.onSurfaceTertiary, letterSpacing: 1, textTransform: 'uppercase', marginTop: SPACING.sm },
  input: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, fontSize: 15, color: THEME.onSurface },
  relRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.xs },
  relChip: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, backgroundColor: THEME.brandTertiary },
  relChipActive: { backgroundColor: THEME.brandPrimary },
  relChipText: { fontSize: 13, color: THEME.brandPrimary, fontWeight: '600' },
  createBtn: { backgroundColor: THEME.brandPrimary, paddingVertical: SPACING.lg, borderRadius: RADIUS.md, alignItems: 'center', marginTop: SPACING.lg },
  createBtnText: { color: THEME.onBrandPrimary, fontSize: 15, fontWeight: '600' },
});
