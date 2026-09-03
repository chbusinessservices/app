import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { THEME, SPACING, RADIUS } from '@/src/theme';
import { api } from '@/src/api';

type Calc = {
  agi?: string; qualified_paid?: string; reimbursements?: string;
  net_qualified_expense?: string; threshold_rate?: string; threshold_amount?: string;
  potentially_deductible?: string;
};
type ValidationResult = {
  claim_id: string; tax_year: number; status: string; risk_tier: string;
  flags: string[]; calculation: Calc; missing_facts: string[];
  review_required: boolean; filing_blocked: boolean; audit_event_id?: string;
  source_status?: string;
};
type EffectiveClaim = { event_type?: string; status: string; filing_blocked: boolean; reviewer_email?: string; previous_status?: string };
type ChainVerify = { valid: boolean; verified: number; total: number; broken_at: number | null };
type CitationRes = {
  grounding_status: string; flags: string[];
  verified_citations: { source: string; status: string }[];
  unsupported_numbers: string[]; requires_review: boolean; risk_tier: string; explanation: string;
};

const TAX_YEARS = [2025, 2024, 2023, 2026];
const CATS = [
  { id: 'medical_dental', label: 'Medical / dental' },
  { id: 'retirement_savers', label: 'Retirement savers' },
  { id: 'student_loan_int', label: 'Student loan int.' },
  { id: 'home_office', label: 'Home office' },
];

const STATUS_COLOR: Record<string, string> = {
  supported: THEME.success,
  potentially_supported: THEME.brandPrimary,
  human_review_required: THEME.warning,
  unsupported: THEME.error,
  contradicted: THEME.error,
  outdated: THEME.error,
};

export default function ValidationScreen() {
  const router = useRouter();
  const [taxYear, setTaxYear] = useState(2025);
  const [agi, setAgi] = useState('100000');
  const [paid, setPaid] = useState('12500');
  const [reimb, setReimb] = useState('1500');
  const [itemizing, setItemizing] = useState(true);
  const [qualified, setQualified] = useState(true);
  const [paidInYear, setPaidInYear] = useState(true);

  const [result, setResult] = useState<ValidationResult | null>(null);
  const [effective, setEffective] = useState<EffectiveClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState('');

  // citation check
  const [answer, setAnswer] = useState('You can deduct medical expenses above 7.5% of your AGI on Schedule A.');
  const [citeSrc, setCiteSrc] = useState('Publication 502');
  const [cat, setCat] = useState('medical_dental');
  const [citeRes, setCiteRes] = useState<CitationRes | null>(null);
  const [citeBusy, setCiteBusy] = useState(false);

  // audit chain
  const [chain, setChain] = useState<ChainVerify | null>(null);

  const loadChain = useCallback(async () => {
    try { setChain(await api<ChainVerify>('/audit/chain/verify')); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { loadChain(); }, [loadChain]));

  async function validate() {
    setError(''); setBusy(true); setResult(null); setEffective(null);
    try {
      const r = await api<ValidationResult>('/validation/medical', {
        method: 'POST',
        body: JSON.stringify({
          tax_year: taxYear,
          agi: Number(agi) || 0,
          paid_medical: Number(paid) || 0,
          reimbursements: Number(reimb) || 0,
          itemizing, qualified_expense: qualified, paid_in_tax_year: paidInYear,
        }),
      });
      setResult(r);
      loadChain();
    } catch (e: any) { setError(e.message || 'Validation failed'); }
    setBusy(false);
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!result) return;
    setDeciding(true);
    try {
      await api(`/validation/medical/${result.claim_id}/decision`, {
        method: 'POST', body: JSON.stringify({ decision, rationale: decision === 'approve' ? 'Reviewed facts and authority.' : 'Rejected by reviewer.' }),
      });
      const eff = await api<EffectiveClaim>(`/validation/medical/${result.claim_id}`);
      setEffective(eff);
      loadChain();
    } catch (e: any) { setError(e.message || 'Decision failed'); }
    setDeciding(false);
  }

  async function checkCitations() {
    setCiteBusy(true); setCiteRes(null);
    try {
      const r = await api<CitationRes>('/validation/citation-check', {
        method: 'POST',
        body: JSON.stringify({
          answer,
          citations: citeSrc.trim() ? [{ source: citeSrc.trim() }] : [],
          tax_year: taxYear,
          category: cat,
        }),
      });
      setCiteRes(r);
    } catch (e: any) { setError(e.message || 'Citation check failed'); }
    setCiteBusy(false);
  }

  const showStatus = effective?.status || result?.status || '';
  const showFilingBlocked = effective ? effective.filing_blocked : result?.filing_blocked;
  const canApprove = result?.status === 'potentially_supported' && !effective;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="validation-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="val-back">
          <Ionicons name="chevron-back" size={22} color={THEME.brandPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tax-Position Validator</Text>
          <Text style={styles.sub}>Pub. 502 medical · deterministic check → human approval</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* --- Facts --- */}
        <Text style={styles.sectionTitle}>1 · Taxpayer facts</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Tax year</Text>
          <View style={styles.chipRow}>
            {TAX_YEARS.map(y => (
              <Pressable key={y} style={[styles.chip, taxYear === y && styles.chipActive]} onPress={() => setTaxYear(y)} testID={`ty-${y}`}>
                <Text style={[styles.chipText, taxYear === y && styles.chipTextActive]}>{y}</Text>
              </Pressable>
            ))}
          </View>

          <LabeledInput label="Adjusted gross income (AGI)" value={agi} onChange={setAgi} testID="input-agi" prefix="$" />
          <LabeledInput label="Medical & dental paid" value={paid} onChange={setPaid} testID="input-paid" prefix="$" />
          <LabeledInput label="Reimbursements" value={reimb} onChange={setReimb} testID="input-reimb" prefix="$" />

          <Toggle label="Itemizing (Schedule A)" on={itemizing} onPress={() => setItemizing(v => !v)} testID="tog-itemizing" />
          <Toggle label="Qualified medical expense" on={qualified} onPress={() => setQualified(v => !v)} testID="tog-qualified" />
          <Toggle label="Paid during tax year" on={paidInYear} onPress={() => setPaidInYear(v => !v)} testID="tog-paidyear" />
        </View>

        <Pressable style={styles.primaryBtn} onPress={validate} disabled={busy} testID="validate-btn">
          {busy ? <ActivityIndicator color={THEME.onBrandPrimary} /> : (
            <><Ionicons name="calculator" size={16} color={THEME.onBrandPrimary} /><Text style={styles.primaryBtnText}>Run deterministic check</Text></>
          )}
        </Pressable>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* --- Result --- */}
        {result ? (
          <View style={{ marginTop: SPACING.lg }}>
            <Text style={styles.sectionTitle}>2 · Validation result</Text>
            <View style={styles.card}>
              <View style={styles.resultHead}>
                <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLOR[effective?.status || result.status] || THEME.onSurfaceTertiary) + '22' }]}>
                  <Ionicons name={result.status === 'potentially_supported' || effective?.status === 'supported' ? 'shield-checkmark' : 'alert-circle'} size={14} color={STATUS_COLOR[effective?.status || result.status] || THEME.onSurfaceTertiary} />
                  <Text style={[styles.statusText, { color: STATUS_COLOR[effective?.status || result.status] || THEME.onSurfaceTertiary }]}>
                    {effective?.status || result.status}
                  </Text>
                </View>
                <View style={[styles.tierPill, { backgroundColor: result.risk_tier === 'high' ? THEME.error + '18' : THEME.brandTertiary }]}>
                  <Text style={[styles.tierText, { color: result.risk_tier === 'high' ? THEME.error : THEME.brandPrimary }]}>{result.risk_tier} risk</Text>
                </View>
              </View>

              {effective?.reviewer_email ? (
                <View style={styles.approvedRow} testID="approved-banner">
                  <Ionicons name="checkmark-circle" size={16} color={THEME.success} />
                  <Text style={styles.approvedText}>Approved by {effective.reviewer_email} · filing unblocked</Text>
                </View>
              ) : null}

              {/* calculation */}
              <View style={styles.calcBox} testID="calc-box">
                <CalcRow label="Qualified paid" value={result.calculation.qualified_paid} />
                <CalcRow label="− Reimbursements" value={result.calculation.reimbursements} />
                <CalcRow label="= Net qualified" value={result.calculation.net_qualified_expense} />
                <View style={styles.calcDivider} />
                <CalcRow label={`AGI × ${result.calculation.threshold_rate} floor`} value={result.calculation.threshold_amount} />
                <View style={styles.calcDivider} />
                <View style={styles.calcDeductRow}>
                  <Text style={styles.calcDeductLabel}>Potentially deductible</Text>
                  <Text style={styles.calcDeductVal}>{result.calculation.potentially_deductible ? `$${result.calculation.potentially_deductible}` : '—'}</Text>
                </View>
              </View>

              {result.flags.length > 0 ? (
                <View style={styles.flagsBox} testID="flags-box">
                  <Text style={styles.flagsTitle}>Flags</Text>
                  {result.flags.map(f => (
                    <View key={f} style={styles.flagRow}><Ionicons name="warning" size={12} color={THEME.warning} /><Text style={styles.flagText}>{f}</Text></View>
                  ))}
                </View>
              ) : null}

              {result.missing_facts.length > 0 ? (
                <View style={styles.missingBox}>
                  <Text style={styles.flagsTitle}>Missing facts</Text>
                  {result.missing_facts.map((m, i) => <Text key={i} style={styles.missingText}>• {m}</Text>)}
                </View>
              ) : null}

              <View style={styles.metaRow}>
                <Ionicons name={showFilingBlocked ? 'lock-closed' : 'lock-open'} size={13} color={showFilingBlocked ? THEME.error : THEME.success} />
                <Text style={[styles.metaText, { color: showFilingBlocked ? THEME.error : THEME.success }]}>
                  {showFilingBlocked ? 'Filing blocked until reviewer approval' : 'Filing unblocked (approved)'}
                </Text>
              </View>
              <Text style={styles.claimId}>claim {result.claim_id}</Text>
            </View>

            {/* reviewer decision */}
            {canApprove ? (
              <View style={styles.decisionRow}>
                <Text style={styles.decisionTitle}>3 · Reviewer decision</Text>
                <Text style={styles.decisionSub}>Only a reviewer can promote this to “supported” and unblock filing.</Text>
                <View style={styles.decisionBtns}>
                  <Pressable style={styles.rejectBtn} onPress={() => decide('reject')} disabled={deciding} testID="reject-btn">
                    <Text style={styles.rejectText}>Reject</Text>
                  </Pressable>
                  <Pressable style={styles.approveBtn} onPress={() => decide('approve')} disabled={deciding} testID="approve-btn">
                    {deciding ? <ActivityIndicator color={THEME.onBrandPrimary} /> : (
                      <><Ionicons name="checkmark" size={16} color={THEME.onBrandPrimary} /><Text style={styles.approveText}>Approve & unblock</Text></>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* --- Citation-gap detector --- */}
        <Text style={[styles.sectionTitle, { marginTop: SPACING.xl }]}>4 · Citation-gap & hallucination check</Text>
        <View style={styles.card}>
          <Text style={styles.label}>AI answer</Text>
          <TextInput style={styles.textArea} value={answer} onChangeText={setAnswer} multiline numberOfLines={3} textAlignVertical="top" testID="cite-answer" />
          <LabeledInput label="Cited source" value={citeSrc} onChange={setCiteSrc} testID="cite-src" />
          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRow}>
            {CATS.map(c => (
              <Pressable key={c.id} style={[styles.chip, cat === c.id && styles.chipActive]} onPress={() => setCat(c.id)}>
                <Text style={[styles.chipText, cat === c.id && styles.chipTextActive]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.secondaryBtn} onPress={checkCitations} disabled={citeBusy} testID="cite-btn">
            {citeBusy ? <ActivityIndicator color={THEME.brandPrimary} /> : (
              <><Ionicons name="shield-half" size={16} color={THEME.brandPrimary} /><Text style={styles.secondaryBtnText}>Check grounding</Text></>
            )}
          </Pressable>

          {citeRes ? (
            <View style={styles.citeResBox} testID="cite-result">
              <View style={styles.citeHead}>
                <View style={[styles.groundBadge, { backgroundColor: (citeRes.grounding_status === 'grounded' ? THEME.success : THEME.error) + '18' }]}>
                  <Text style={[styles.groundText, { color: citeRes.grounding_status === 'grounded' ? THEME.success : THEME.error }]}>{citeRes.grounding_status}</Text>
                </View>
                <Text style={styles.citeRisk}>{citeRes.risk_tier} risk</Text>
              </View>
              {citeRes.flags.length > 0 ? (
                <View style={styles.flagsBox}>
                  {citeRes.flags.map(f => (
                    <View key={f} style={styles.flagRow}><Ionicons name="warning" size={12} color={THEME.warning} /><Text style={styles.flagText}>{f}</Text></View>
                  ))}
                </View>
              ) : <Text style={styles.citeOk}>No hallucination patterns detected.</Text>}
              {citeRes.verified_citations.map((c, i) => (
                <View key={i} style={styles.citeCiteRow}>
                  <Ionicons name={c.status === 'verified' ? 'checkmark-circle' : 'close-circle'} size={13} color={c.status === 'verified' ? THEME.success : THEME.error} />
                  <Text style={styles.citeCiteText}>{c.source} — {c.status}</Text>
                </View>
              ))}
              {citeRes.unsupported_numbers.length > 0 ? (
                <Text style={styles.citeNums}>Unsupported figures: {citeRes.unsupported_numbers.join(', ')}</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* --- Audit chain --- */}
        <Text style={[styles.sectionTitle, { marginTop: SPACING.xl }]}>5 · Tamper-evident audit chain</Text>
        <View style={styles.card} testID="chain-card">
          {chain ? (
            <View style={styles.chainRow}>
              <Ionicons name={chain.valid ? 'shield-checkmark' : 'warning'} size={18} color={chain.valid ? THEME.success : THEME.error} />
              <View style={{ flex: 1 }}>
                <Text style={styles.chainTitle}>{chain.valid ? 'Chain intact' : 'Chain BROKEN'}</Text>
                <Text style={styles.chainSub}>{chain.verified}/{chain.total} records verified{chain.broken_at != null ? ` · broken at #${chain.broken_at + 1}` : ''}</Text>
              </View>
            </View>
          ) : <ActivityIndicator color={THEME.brandPrimary} />}
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function LabeledInput({ label, value, onChange, testID, prefix }: { label: string; value: string; onChange: (v: string) => void; testID?: string; prefix?: string }) {
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputBox}>
        {prefix ? <Text style={styles.inputPrefix}>{prefix}</Text> : null}
        <TextInput style={styles.input} value={value} onChangeText={onChange} keyboardType="numeric" testID={testID} />
      </View>
    </View>
  );
}

function Toggle({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable style={styles.toggleRow} onPress={onPress} testID={testID}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.toggleSwitch, { backgroundColor: on ? THEME.brandPrimary : THEME.surfaceTertiary }]}>
        <View style={[styles.toggleKnob, on && styles.toggleKnobOn]} />
      </View>
    </Pressable>
  );
}

function CalcRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.calcRow}>
      <Text style={styles.calcLabel}>{label}</Text>
      <Text style={styles.calcVal}>{value ? `$${value}` : '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, gap: SPACING.xs },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: THEME.onSurface },
  sub: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 2 },
  content: { padding: SPACING.lg },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: THEME.onSurface, marginBottom: SPACING.sm },
  card: { backgroundColor: THEME.surfaceSecondary, borderRadius: RADIUS.lg, padding: SPACING.lg, borderWidth: 1, borderColor: THEME.border },
  label: { fontSize: 12, fontWeight: '600', color: THEME.onSurfaceTertiary, marginBottom: 6, marginTop: SPACING.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surface },
  chipActive: { backgroundColor: THEME.brandPrimary, borderColor: THEME.brandPrimary },
  chipText: { fontSize: 13, fontWeight: '600', color: THEME.onSurface },
  chipTextActive: { color: THEME.onBrandPrimary },
  inputWrap: { marginTop: SPACING.sm },
  inputBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: THEME.border, borderRadius: RADIUS.md, backgroundColor: THEME.surface, paddingHorizontal: SPACING.md },
  inputPrefix: { fontSize: 15, color: THEME.onSurfaceTertiary, fontWeight: '600' },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: THEME.onSurface, marginLeft: 4 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.md, marginTop: SPACING.xs },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: THEME.onSurface, flex: 1 },
  toggleSwitch: { width: 44, height: 26, borderRadius: 13, padding: 2, justifyContent: 'center' },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFF' },
  toggleKnobOn: { alignSelf: 'flex-end' },
  primaryBtn: { flexDirection: 'row', gap: 8, backgroundColor: THEME.brandPrimary, paddingVertical: SPACING.lg, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.lg },
  primaryBtnText: { color: THEME.onBrandPrimary, fontWeight: '700', fontSize: 15 },
  secondaryBtn: { flexDirection: 'row', gap: 8, backgroundColor: THEME.brandTertiary, paddingVertical: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.md },
  secondaryBtnText: { color: THEME.brandPrimary, fontWeight: '700', fontSize: 14 },
  errorText: { color: THEME.error, fontSize: 13, marginTop: SPACING.md, textAlign: 'center' },
  resultHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, paddingVertical: 5, borderRadius: RADIUS.pill },
  statusText: { fontSize: 13, fontWeight: '700' },
  tierPill: { paddingHorizontal: SPACING.md, paddingVertical: 5, borderRadius: RADIUS.pill },
  tierText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  approvedRow: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: THEME.brandTertiary, padding: SPACING.sm, borderRadius: RADIUS.md, marginBottom: SPACING.md },
  approvedText: { fontSize: 12, fontWeight: '600', color: THEME.success, flex: 1 },
  calcBox: { backgroundColor: THEME.surface, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md },
  calcRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  calcLabel: { fontSize: 13, color: THEME.onSurfaceTertiary },
  calcVal: { fontSize: 13, fontWeight: '600', color: THEME.onSurface },
  calcDivider: { height: 1, backgroundColor: THEME.border, marginVertical: 6 },
  calcDeductRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  calcDeductLabel: { fontSize: 14, fontWeight: '700', color: THEME.onSurface },
  calcDeductVal: { fontSize: 18, fontWeight: '700', color: THEME.success },
  flagsBox: { backgroundColor: THEME.warning + '12', borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md },
  flagsTitle: { fontSize: 12, fontWeight: '700', color: THEME.warning, marginBottom: 4 },
  flagRow: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 2 },
  flagText: { fontSize: 12, color: THEME.onSurface, fontWeight: '500' },
  missingBox: { marginBottom: SPACING.md },
  missingText: { fontSize: 12, color: THEME.onSurfaceTertiary, paddingVertical: 1 },
  metaRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: SPACING.xs },
  metaText: { fontSize: 12, fontWeight: '600' },
  claimId: { fontSize: 11, color: THEME.onSurfaceTertiary, marginTop: 6 },
  decisionRow: { marginTop: SPACING.lg },
  decisionTitle: { fontSize: 15, fontWeight: '700', color: THEME.onSurface, marginBottom: 4 },
  decisionSub: { fontSize: 12, color: THEME.onSurfaceTertiary, marginBottom: SPACING.md },
  decisionBtns: { flexDirection: 'row', gap: SPACING.md },
  rejectBtn: { flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center', borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surface },
  rejectText: { color: THEME.error, fontSize: 14, fontWeight: '700' },
  approveBtn: { flex: 1.4, flexDirection: 'row', gap: 6, paddingVertical: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.brandPrimary },
  approveText: { color: THEME.onBrandPrimary, fontSize: 14, fontWeight: '700' },
  textArea: { borderWidth: 1, borderColor: THEME.border, borderRadius: RADIUS.md, backgroundColor: THEME.surface, padding: SPACING.md, fontSize: 14, color: THEME.onSurface, minHeight: 72 },
  citeResBox: { marginTop: SPACING.md, backgroundColor: THEME.surface, borderRadius: RADIUS.md, padding: SPACING.md },
  citeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  groundBadge: { paddingHorizontal: SPACING.md, paddingVertical: 5, borderRadius: RADIUS.pill },
  groundText: { fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  citeRisk: { fontSize: 12, color: THEME.onSurfaceTertiary, fontWeight: '600' },
  citeOk: { fontSize: 12, color: THEME.success, fontWeight: '600' },
  citeCiteRow: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 2 },
  citeCiteText: { fontSize: 12, color: THEME.onSurface },
  citeNums: { fontSize: 11, color: THEME.error, marginTop: 4 },
  chainRow: { flexDirection: 'row', gap: SPACING.md, alignItems: 'center' },
  chainTitle: { fontSize: 15, fontWeight: '700', color: THEME.onSurface },
  chainSub: { fontSize: 12, color: THEME.onSurfaceTertiary, marginTop: 2 },
});
