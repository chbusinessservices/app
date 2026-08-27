import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { API_BASE, getToken } from '@/src/api';

const DOC_TYPES = ['Auto', 'W-2', '1099-NEC', '1099-INT', '1099-DIV', 'K-1', 'Receipt', 'Prior-Year Return', 'Other'];

export default function UploadScreen() {
  const router = useRouter();
  const [docType, setDocType] = useState('Auto');
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function pickImage() {
    setErr(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr('Photo access denied'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (res.canceled) return;
    await uploadAsset(res.assets[0].uri, res.assets[0].fileName || `photo-${Date.now()}.jpg`, res.assets[0].mimeType || 'image/jpeg');
  }

  async function pickCamera() {
    setErr(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setErr('Camera access denied'); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (res.canceled) return;
    await uploadAsset(res.assets[0].uri, `scan-${Date.now()}.jpg`, res.assets[0].mimeType || 'image/jpeg');
  }

  async function pickDocument() {
    setErr(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    if (res.canceled) return;
    const a = res.assets[0];
    await uploadAsset(a.uri, a.name || `doc-${Date.now()}`, a.mimeType || 'application/octet-stream');
  }

  async function uploadAsset(uri: string, name: string, type: string) {
    try {
      setUploading(true);
      setProgress('Uploading…');
      const token = await getToken();
      const form = new FormData();
      if (Platform.OS === 'web') {
        const blob = await (await fetch(uri)).blob();
        form.append('file', blob, name);
      } else {
        form.append('file', { uri, name, type } as any);
      }
      form.append('doc_type_hint', docType);
      const res = await fetch(`${API_BASE}/documents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');

      setProgress('Extracting with AI…');
      const extractRes = await fetch(`${API_BASE}/documents/${data.document_id}/extract?model=claude-sonnet-5`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (!extractRes.ok) throw new Error('Extraction failed');
      router.replace(`/document/${data.document_id}`);
    } catch (e: any) {
      setErr(e.message || 'Upload failed');
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={THEME.onSurface} />
        </Pressable>
        <Text style={styles.title}>Upload document</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sub}>Drop in W-2s, 1099s, K-1s, receipts, or prior-year returns. TaxPilot will classify and extract with confidence scores.</Text>

        <Text style={styles.label}>Document type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {DOC_TYPES.map(t => (
            <Pressable
              key={t} onPress={() => setDocType(t)}
              style={[styles.chip, docType === t && styles.chipActive]}
              testID={`doctype-${t}`}
            >
              <Text style={[styles.chipText, docType === t && styles.chipTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.optionCol}>
          <Pressable style={styles.option} onPress={pickCamera} disabled={uploading} testID="upload-camera-btn">
            <View style={styles.optIcon}><Ionicons name="camera" size={22} color={THEME.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.optTitle}>Scan with camera</Text>
              <Text style={styles.optSub}>Capture a W-2 or receipt</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={THEME.onSurfaceTertiary} />
          </Pressable>
          <Pressable style={styles.option} onPress={pickImage} disabled={uploading} testID="upload-photos-btn">
            <View style={styles.optIcon}><Ionicons name="images" size={22} color={THEME.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.optTitle}>Pick from photos</Text>
              <Text style={styles.optSub}>Choose an existing image</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={THEME.onSurfaceTertiary} />
          </Pressable>
          <Pressable style={styles.option} onPress={pickDocument} disabled={uploading} testID="upload-files-btn">
            <View style={styles.optIcon}><Ionicons name="document" size={22} color={THEME.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.optTitle}>Choose a file</Text>
              <Text style={styles.optSub}>PDF or image from Files</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={THEME.onSurfaceTertiary} />
          </Pressable>
        </View>

        {uploading && (
          <View style={styles.busy}>
            <ActivityIndicator color={THEME.brandPrimary} />
            <Text style={styles.busyText}>{progress}</Text>
          </View>
        )}
        {err && <Text style={styles.err} testID="upload-error">{err}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: THEME.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: THEME.onSurface },
  content: { padding: SPACING.lg },
  sub: { fontSize: 14, color: THEME.onSurfaceTertiary, lineHeight: 20, marginBottom: SPACING.xl },
  label: { fontSize: 12, fontWeight: '700', color: THEME.onSurfaceTertiary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SPACING.md },
  chipsRow: { gap: SPACING.sm, paddingBottom: SPACING.lg },
  chip: { height: 36, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.pill, backgroundColor: THEME.surfaceSecondary, borderWidth: 1, borderColor: THEME.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chipActive: { backgroundColor: THEME.brandPrimary, borderColor: THEME.brandPrimary },
  chipText: { fontSize: 13, color: THEME.onSurfaceTertiary, fontWeight: '600' },
  chipTextActive: { color: THEME.onBrandPrimary },
  optionCol: { gap: SPACING.md, marginTop: SPACING.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.lg, backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: THEME.border },
  optIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: THEME.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  optTitle: { fontSize: 15, fontWeight: '600', color: THEME.onSurface },
  optSub: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 2 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginTop: SPACING.xl, padding: SPACING.lg, backgroundColor: THEME.brandTertiary, borderRadius: RADIUS.md },
  busyText: { color: THEME.brandPrimary, fontWeight: '600' },
  err: { color: THEME.error, marginTop: SPACING.lg, fontSize: 13, textAlign: 'center' },
});
