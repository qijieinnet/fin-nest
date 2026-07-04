"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AttachmentPicker, DateWheelPicker, type AttachmentItem } from "@/components/business";
import { IconButton, Input } from "@/components/ui";
import {
  apiRequest,
  createAuthorizedObjectUrl,
  getApiErrorMessage,
  ledgerApiPath,
  type Insurance,
  type Person,
  uploadAttachmentFile,
} from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import { useAttachments, useInsurance } from "@/lib/data/records";
import { createClientId } from "@/lib/id/client-id";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import {
  INSURANCE_TYPES,
  microsToInput,
  PREMIUM_FREQ_OPTIONS,
  RENEWAL_OPTIONS,
  todayKey,
} from "./insurance-utils";

type InsuranceEditorSheetProps = {
  insurance?: Insurance;
  ledgerId: string;
  people: Person[];
};

type PendingAttachment = AttachmentItem & { file: File };

function Chip({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13.5px] font-medium transition-colors",
        active
          ? "bg-[var(--color-tint)] text-[var(--color-tint-contrast)]"
          : "bg-[var(--color-control-fill-muted)] text-[var(--color-text-secondary)]",
      )}
      onClick={onClick}
      type="button"
    >
      {icon ? <span>{icon}</span> : null}
      {label}
    </button>
  );
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">{title}</h3>
      <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        {children}
      </div>
    </section>
  );
}

async function uploadInsuranceAttachment(
  ledgerId: string,
  insuranceId: string,
  item: PendingAttachment,
) {
  await uploadAttachmentFile(ledgerId, "insurance", insuranceId, item.file);
}

export function InsuranceEditorSheet({ insurance, ledgerId, people }: InsuranceEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const isEditing = Boolean(insurance);

  const detailQuery = useInsurance(ledgerId, insurance?.id ?? null);
  const existingAttachmentsQuery = useAttachments(ledgerId, "insurance", insurance?.id ?? null);

  const [name, setName] = useState(insurance?.name ?? "");
  const [type, setType] = useState(insurance?.type ?? "medical");
  const [insurer, setInsurer] = useState(insurance?.insurer ?? "");
  const [policyNo, setPolicyNo] = useState(insurance?.policyNo ?? "");
  const [method, setMethod] = useState(insurance?.method ?? "");
  const [insuredIds, setInsuredIds] = useState<string[]>([]);
  const [coverage, setCoverage] = useState(() => microsToInput(insurance?.coverageMicros));
  const [premium, setPremium] = useState(() => microsToInput(insurance?.premiumMicros));
  const [premiumFreq, setPremiumFreq] = useState(insurance?.premiumFreq ?? "year");
  const [periods, setPeriods] = useState(insurance?.periods ? String(insurance.periods) : "");
  const [renewal, setRenewal] = useState(insurance?.renewal ?? "auto");
  const [startDate, setStartDate] = useState(insurance?.startDate?.slice(0, 10) ?? "");
  const [endDate, setEndDate] = useState(insurance?.endDate?.slice(0, 10) ?? "");
  const [coverageDesc, setCoverageDesc] = useState(insurance?.coverageDesc ?? "");
  const [note, setNote] = useState(insurance?.note ?? "");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const pendingRef = useRef<PendingAttachment[]>([]);
  const seededInsured = useRef(false);

  // 编辑模式下，被保人来自详情接口，加载后回填一次（不覆盖用户后续修改）。
  useEffect(() => {
    if (seededInsured.current) return;
    if (detailQuery.data) {
      setInsuredIds(detailQuery.data.insuredPeople.map((entry) => entry.personId));
      seededInsured.current = true;
    }
  }, [detailQuery.data]);

  useEffect(() => {
    pendingRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(
    () => () => {
      for (const attachment of pendingRef.current) {
        if (attachment.url) URL.revokeObjectURL(attachment.url);
      }
    },
    [],
  );

  const existingAttachments = useMemo(
    () =>
      (existingAttachmentsQuery.data ?? [])
        .filter((record) => !removedAttachmentIds.includes(record.id))
        .map<AttachmentItem>((record) => ({
          id: record.id,
          name: record.file?.originalName ?? "附件",
          contentType: record.file?.mime ?? undefined,
        })),
    [existingAttachmentsQuery.data, removedAttachmentIds],
  );
  const attachmentItems = [...existingAttachments, ...pendingAttachments];

  const freqIsSingle = premiumFreq === "single";
  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const coverageParsed = coverage.trim() ? parseMoneyToMicros(coverage) : null;
      if (coverageParsed && !coverageParsed.ok) throw new Error("保额格式不正确");
      const premiumParsed = premium.trim() ? parseMoneyToMicros(premium) : null;
      if (premiumParsed && !premiumParsed.ok) throw new Error("保费格式不正确");
      const periodsValue = periods.trim() ? Number.parseInt(periods, 10) : undefined;
      if (periodsValue !== undefined && (!Number.isFinite(periodsValue) || periodsValue < 1)) {
        throw new Error("缴费期数需为正整数");
      }
      const body = {
        type,
        name: trimmedName,
        insurer: insurer.trim() || undefined,
        policyNo: policyNo.trim() || undefined,
        method: method.trim() || undefined,
        insuredPersonIds: insuredIds,
        coverageMicros: coverageParsed?.amountMicros,
        premiumMicros: premiumParsed?.amountMicros,
        premiumFreq,
        periods: freqIsSingle ? undefined : periodsValue,
        renewal: freqIsSingle ? undefined : renewal,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        coverageDesc: coverageDesc.trim() || undefined,
        note: note.trim() || undefined,
      };
      const saved = insurance
        ? await apiRequest<Insurance>(ledgerApiPath(ledgerId, `/insurances/${insurance.id}`), {
            method: "PATCH",
            body,
          })
        : await apiRequest<Insurance>(ledgerApiPath(ledgerId, "/insurances"), {
            method: "POST",
            body,
          });

      for (const attachmentId of removedAttachmentIds) {
        await apiRequest(ledgerApiPath(ledgerId, `/attachments/${attachmentId}`), {
          method: "DELETE",
        });
      }
      for (const attachment of pendingAttachments) {
        await uploadInsuranceAttachment(ledgerId, saved.id, attachment);
      }
      return saved;
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.insurances(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.insurance(ledgerId, saved.id) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.attachments(ledgerId, "insurance", saved.id),
        }),
      ]);
      showToast({ tone: "success", message: isEditing ? "保单已更新" : "保单已添加" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
  });

  function addFiles(files: File[]) {
    setPendingAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: createClientId("attachment"),
        name: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        file,
      })),
    ]);
  }

  function removeAttachment(id: string) {
    const pending = pendingAttachments.find((item) => item.id === id);
    if (pending) {
      if (pending.url) URL.revokeObjectURL(pending.url);
      setPendingAttachments((current) => current.filter((item) => item.id !== id));
      return;
    }
    setRemovedAttachmentIds((current) => [...current, id]);
  }

  async function openAttachment(item: AttachmentItem) {
    const pending = pendingAttachments.find((entry) => entry.id === item.id);
    if (pending?.url) {
      return pending.url;
    }
    try {
      return await createAuthorizedObjectUrl(
        ledgerApiPath(ledgerId, `/attachments/${item.id}/content`),
      );
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, "无法打开附件") });
    }
  }

  const toggleInsured = (personId: string) => {
    setInsuredIds((current) =>
      current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId],
    );
  };

  return (
    <form
      className="flex flex-col gap-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !save.isPending) save.mutate();
      }}
    >
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {isEditing ? "编辑保单" : "添加保单"}
        </h2>
        <IconButton
          disabled={!canSubmit || save.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存保单"
          variant="primary"
          type="submit"
        />
      </div>

      <Input
        aria-label="保单名称"
        label="保单名称"
        maxLength={120}
        onChange={(event) => setName(event.target.value)}
        placeholder="如：百万医疗险"
        value={name}
      />

      <Section title="险种">
        <div className="flex flex-wrap gap-2">
          {INSURANCE_TYPES.map((option) => (
            <Chip
              active={type === option.value}
              icon={option.icon}
              key={option.value}
              label={option.label}
              onClick={() => setType(option.value)}
            />
          ))}
        </div>
      </Section>

      <div className="flex flex-col gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <Input
          label="保险公司"
          onChange={(event) => setInsurer(event.target.value)}
          placeholder="如：平安保险"
          value={insurer}
        />
        <Input
          label="保单号"
          onChange={(event) => setPolicyNo(event.target.value)}
          placeholder="选填"
          value={policyNo}
        />
        <Input
          label="投保方式"
          onChange={(event) => setMethod(event.target.value)}
          placeholder="选填，如 线上自助 / 代理人"
          value={method}
        />
      </div>

      <Section title="被保人 · 可多选">
        {people.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            还没有人员，可到「人员管理」中添加
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {people.map((person) => (
              <Chip
                active={insuredIds.includes(person.id)}
                key={person.id}
                label={person.name}
                onClick={() => toggleInsured(person.id)}
              />
            ))}
          </div>
        )}
      </Section>

      <div className="flex flex-col gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <Input
          inputMode="decimal"
          label="保额"
          onChange={(event) => setCoverage(event.target.value)}
          placeholder="0"
          prefix="¥"
          value={coverage}
        />
        <div className="flex flex-col gap-1.5">
          <span className="ui-field__label px-0.5">缴费周期</span>
          <div className="flex flex-wrap gap-2">
            {PREMIUM_FREQ_OPTIONS.map((option) => (
              <Chip
                active={premiumFreq === option.value}
                key={option.value}
                label={option.label}
                onClick={() => setPremiumFreq(option.value)}
              />
            ))}
          </div>
        </div>
        <Input
          inputMode="decimal"
          label={freqIsSingle ? "保费" : premiumFreq === "month" ? "每月保费" : "每年保费"}
          onChange={(event) => setPremium(event.target.value)}
          placeholder="0"
          prefix="¥"
          value={premium}
        />
        {!freqIsSingle ? (
          <>
            <Input
              inputMode="numeric"
              label="缴费期数（选填）"
              onChange={(event) => setPeriods(event.target.value)}
              placeholder="如：20"
              value={periods}
            />
            <div className="flex flex-col gap-1.5">
              <span className="ui-field__label px-0.5">续费</span>
              <div className="flex flex-wrap gap-2">
                {RENEWAL_OPTIONS.map((option) => (
                  <Chip
                    active={renewal === option.value}
                    key={option.value}
                    label={option.label}
                    onClick={() => setRenewal(option.value)}
                  />
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <Section title="保障期间">
        <div className="flex flex-col gap-3">
          <OptionalDateRow label="生效日" onChange={setStartDate} value={startDate} />
          <OptionalDateRow label="到期日" onChange={setEndDate} value={endDate} />
        </div>
      </Section>

      <AttachmentPicker
        accept="image/*,application/pdf,video/*,.doc,.docx,.xls,.xlsx"
        enabled
        items={attachmentItems}
        onFilesSelected={addFiles}
        onOpen={openAttachment}
        onRemove={removeAttachment}
      />

      <Section title="保障内容">
        <textarea
          className="min-h-[78px] w-full resize-none bg-transparent text-[15px] leading-6 text-[var(--color-text-primary)] outline-none"
          onChange={(event) => setCoverageDesc(event.target.value)}
          placeholder="选填，如 一般医疗+重疾医疗，0免赔…"
          value={coverageDesc}
        />
      </Section>

      <Input
        label="备注"
        maxLength={240}
        onChange={(event) => setNote(event.target.value)}
        placeholder="选填，如 含三者险 / 缴费方式…"
        value={note}
      />
    </form>
  );
}

function OptionalDateRow({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  if (!value) {
    return (
      <button
        className="flex items-center justify-between rounded-[12px] bg-[var(--color-control-fill-muted)] px-4 py-3 text-[15px] text-[var(--color-text-secondary)]"
        onClick={() => onChange(todayKey())}
        type="button"
      >
        <span>{label}</span>
        <span className="text-[var(--color-text-muted)]">点击选择</span>
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <DateWheelPicker label={label} onValueChange={onChange} value={value} />
      </div>
      <button
        className="shrink-0 text-[13px] text-[var(--color-text-muted)]"
        onClick={() => onChange("")}
        type="button"
      >
        清除
      </button>
    </div>
  );
}
