"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, X } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttachmentPicker,
  DateWheelPicker,
  ReminderSchedulesEditor,
  toReminderDrafts,
  toReminderPayload,
  type AttachmentItem,
  type ReminderDraft,
} from "@/components/business";
import { IconButton, PopoverMenu } from "@/components/ui";
import {
  apiRequest,
  createAuthorizedObjectUrl,
  getApiErrorMessage,
  ledgerApiPath,
  type Insurance,
  type Person,
  uploadAttachmentFile,
} from "@/lib/api";
import { useFeishuStatus, useLedgerFeishuBindings } from "@/lib/data/feishu";
import { useAttachments, useInsurance } from "@/lib/data/records";
import { createClientId } from "@/lib/id/client-id";
import { microsToInput, parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useDecimalPlaces, useSheetStack, useToast } from "@/providers";
import {
  INSURANCE_TYPES,
  PREMIUM_FREQ_OPTIONS,
  RENEWAL_OPTIONS,
  todayKey,
  todayPlusYearsKey,
} from "./insurance-utils";

/** 新增一档提醒时的默认提前量：保单按 30 天。 */
const DEFAULT_REMIND_LEAD_DAYS = 30;

type InsuranceEditorSheetProps = {
  insurance?: Insurance;
  ledgerId: string;
  people: Person[];
};

type PendingAttachment = AttachmentItem & { file: File };

/** 多选行：点按弹出 PopoverMenu 勾选（被保人可多选；勾选后菜单关闭，再点开可继续增减）。 */
function MultiSelectRow({
  emptyLabel,
  label,
  onToggle,
  options,
  placeholder,
  values,
}: {
  emptyLabel: string;
  label: string;
  onToggle: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
  placeholder: string;
  values: string[];
}) {
  const [open, setOpen] = useState(false);
  const selectedLabels = options
    .filter((option) => values.includes(option.value))
    .map((option) => option.label);
  const isEmpty = options.length === 0;
  const display = isEmpty
    ? emptyLabel
    : selectedLabels.length > 0
      ? selectedLabels.join("、")
      : placeholder;
  return (
    <div className="transaction-form__card transaction-form__picker-card">
      <div className="relative">
        <button
          className="transaction-form__select-row"
          disabled={isEmpty}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span>{label}</span>
          <strong>{display}</strong>
          <ChevronRight size={18} />
        </button>
        <PopoverMenu
          groups={[
            options.map((option) => ({
              label: option.label,
              onSelect: () => onToggle(option.value),
              selected: values.includes(option.value),
            })),
          ]}
          onOpenChange={setOpen}
          open={open}
        />
      </div>
    </div>
  );
}

/** 记一笔风格的整卡输入行：标签在左，输入右对齐。 */
function FieldRow({
  inputMode,
  label,
  maxLength,
  onChange,
  placeholder,
  prefix,
  value,
}: {
  inputMode?: "decimal" | "numeric" | "text";
  label: string;
  maxLength?: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  prefix?: string;
  value: string;
}) {
  return (
    <label className="account-form__field-row">
      <span>{label}</span>
      <span className="account-form__input-wrap">
        {prefix ? <span className="account-form__prefix">{prefix}</span> : null}
        <input
          className="account-form__input"
          inputMode={inputMode}
          maxLength={maxLength}
          onChange={onChange}
          placeholder={placeholder}
          value={value}
        />
      </span>
    </label>
  );
}

/** 记一笔风格的选值行：点按弹出 PopoverMenu 选择（用于险种、缴费周期等枚举）。 */
function SelectRow({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ icon?: string; label: string; value: string }>;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <div className="transaction-form__card transaction-form__picker-card">
      <div className="relative">
        <button
          className="transaction-form__select-row"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span>{label}</span>
          <strong>
            {selected ? `${selected.icon ? `${selected.icon} ` : ""}${selected.label}` : "请选择"}
          </strong>
          <ChevronRight size={18} />
        </button>
        <PopoverMenu
          groups={[
            options.map((option) => ({
              icon: option.icon ? <span>{option.icon}</span> : undefined,
              label: option.label,
              onSelect: () => onChange(option.value),
              selected: option.value === value,
            })),
          ]}
          onOpenChange={setOpen}
          open={open}
        />
      </div>
    </div>
  );
}

/** 带标题的整卡容器，用于承载 chip 组、多行文本等非行内内容。 */
function LabeledCard({
  children,
  hint,
  label,
}: {
  children: ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <div className="transaction-form__card">
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            {label}
          </span>
          {hint ? <span className="text-[12px] text-[var(--color-text-muted)]">{hint}</span> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** 日期行：未设置时点按填入今天，已设置后展示滚轮选择器（与账户表单一致）。 */
function DateFieldRow({
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
      <div className="transaction-form__date-card">
        <button className="biz-date-picker" onClick={() => onChange(todayKey())} type="button">
          <span className="biz-date-popover__summary">
            <span>{label}</span>
            <strong>未选择</strong>
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className="transaction-form__date-card">
      <DateWheelPicker label={label} onValueChange={onChange} value={value} />
    </div>
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
  const decimalPlaces = useDecimalPlaces();
  const isEditing = Boolean(insurance);

  const detailQuery = useInsurance(ledgerId, insurance?.id ?? null);
  const existingAttachmentsQuery = useAttachments(ledgerId, "insurance", insurance?.id ?? null);
  // 未配置飞书时不发这个请求，整行也不渲染——这是「没开这个功能」，不是「没绑账号」。
  const feishuStatusQuery = useFeishuStatus();
  const feishuEnabled = feishuStatusQuery.data?.enabled ?? false;
  const feishuBindingsQuery = useLedgerFeishuBindings(ledgerId, feishuEnabled);

  const [name, setName] = useState(insurance?.name ?? "");
  const [type, setType] = useState(insurance?.type ?? "medical");
  const [insurer, setInsurer] = useState(insurance?.insurer ?? "");
  const [policyNo, setPolicyNo] = useState(insurance?.policyNo ?? "");
  const [method, setMethod] = useState(insurance?.method ?? "");
  const [paymentMethod, setPaymentMethod] = useState(insurance?.paymentMethod ?? "");
  const [insuredIds, setInsuredIds] = useState<string[]>([]);
  const [coverage, setCoverage] = useState(() => microsToInput(insurance?.coverageMicros, { decimalPlaces }));
  const [premium, setPremium] = useState(() => microsToInput(insurance?.premiumMicros, { decimalPlaces }));
  const [premiumFreq, setPremiumFreq] = useState(insurance?.premiumFreq ?? "year");
  const [periods, setPeriods] = useState(insurance?.periods ? String(insurance.periods) : "");
  const [renewal, setRenewal] = useState(insurance?.renewal ?? "auto");
  // 新建保单默认生效日为今天、到期日为次年今天；编辑时沿用已有值（可为空）。
  const [startDate, setStartDate] = useState(
    insurance ? (insurance.startDate?.slice(0, 10) ?? "") : todayKey(),
  );
  const [endDate, setEndDate] = useState(
    insurance ? (insurance.endDate?.slice(0, 10) ?? "") : todayPlusYearsKey(1),
  );
  const [coverageDesc, setCoverageDesc] = useState(insurance?.coverageDesc ?? "");
  const [reminders, setReminders] = useState<ReminderDraft[]>(() =>
    toReminderDrafts(insurance?.reminders),
  );
  const [remindEnabled, setRemindEnabled] = useState(() => (insurance?.reminders?.length ?? 0) > 0);
  const [note, setNote] = useState(insurance?.note ?? "");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const pendingRef = useRef<PendingAttachment[]>([]);
  const seededInsured = useRef(false);
  const seededReminders = useRef((insurance?.reminders?.length ?? 0) > 0);
  const seededAttachments = useRef(false);

  // 提醒档位：列表数据可能是打开弹层前缓存的，详情接口回来后以它为准回填一次。
  // 只在「本地还没有档位」时回填，避免覆盖用户已经改了一半的内容。
  useEffect(() => {
    if (seededReminders.current) return;
    const fromDetail = detailQuery.data?.reminders;
    if (!fromDetail) return;
    seededReminders.current = true;
    if (fromDetail.length === 0) return;
    setReminders(toReminderDrafts(fromDetail));
    setRemindEnabled(true);
  }, [detailQuery.data]);

  // 编辑模式下，被保人来自详情接口，加载后回填一次（不覆盖用户后续修改）。
  useEffect(() => {
    if (seededInsured.current) return;
    if (detailQuery.data) {
      setInsuredIds(detailQuery.data.insuredPeople.map((entry) => entry.personId));
      seededInsured.current = true;
    }
  }, [detailQuery.data]);

  // 已有附件时默认展开附件区域，其余情况默认关闭，需手动打开再上传。
  useEffect(() => {
    if (seededAttachments.current) return;
    const records = existingAttachmentsQuery.data;
    if (!records) return;
    seededAttachments.current = true;
    if (records.length > 0) setAttachmentsEnabled(true);
  }, [existingAttachmentsQuery.data]);

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

  const save = useMutation({
    mutationFn: async () => {
      const coverageParsed = coverage.trim() ? parseMoneyToMicros(coverage, { decimalPlaces }) : null;
      if (coverageParsed && !coverageParsed.ok) throw new Error("保额格式不正确");
      const premiumParsed = premium.trim() ? parseMoneyToMicros(premium, { decimalPlaces }) : null;
      if (premiumParsed && !premiumParsed.ok) throw new Error("保费格式不正确");
      const periodsValue = periods.trim() ? Number.parseInt(periods, 10) : undefined;
      if (periodsValue !== undefined && (!Number.isFinite(periodsValue) || periodsValue < 1)) {
        throw new Error("缴费期数需为正整数");
      }
      // 关掉开关就提交空数组：后端据此清空所有档位与接收人（镜像列一并置空）。
      const reminderPayload = remindEnabled ? toReminderPayload(reminders) : [];
      const body = {
        type,
        name: trimmedName,
        insurer: insurer.trim() || undefined,
        policyNo: policyNo.trim() || undefined,
        method: method.trim() || undefined,
        paymentMethod: paymentMethod.trim() || undefined,
        insuredPersonIds: insuredIds,
        coverageMicros: coverageParsed?.amountMicros,
        premiumMicros: premiumParsed?.amountMicros,
        premiumFreq,
        periods: freqIsSingle ? undefined : periodsValue,
        renewal: freqIsSingle ? undefined : renewal,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        reminders: reminderPayload,
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
  });

  function addFiles(files: File[]) {
    setPendingAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: createClientId("attachment"),
        name: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        // 新选附件用本地 blob URL 预览/下载（含 PDF/视频等）；其 id 是客户端临时 id，
        // 尚未落库，绝不能拿它去请求服务器 /attachments/:id/content。
        url: URL.createObjectURL(file),
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

  // 同一个人可能绑多个飞书号，所以标签是「昵称（成员别名）」；昵称取不到时回退 open_id 尾段。
  const feishuTargetOptions = useMemo(
    () =>
      (feishuBindingsQuery.data ?? []).map((binding) => ({
        value: binding.id,
        label: `${binding.displayName ?? `飞书账号 ···${binding.openIdSuffix}`}（${binding.userAlias}）`,
      })),
    [feishuBindingsQuery.data],
  );

  const toggleInsured = (personId: string) => {
    setInsuredIds((current) =>
      current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId],
    );
  };

  const canSubmit = trimmedName.length > 0 && !save.isPending;

  return (
    <form
      className="transaction-form flex min-h-0 flex-1 flex-col !gap-0 !pb-0"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !save.isPending) save.mutate();
      }}
    >
      <div className="grid shrink-0 grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3 pb-2">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {isEditing ? "编辑保单" : "添加保单"}
        </h2>
        <IconButton
          disabled={!canSubmit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存保单"
          loading={save.isPending}
          variant="primary"
          type="submit"
        />
      </div>

      <div className="sheet-form-scroll flex-1 pb-6">
        <div className="transaction-form__cards">
          <div className="transaction-form__card">
            <FieldRow
              label="保单名称"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="如：百万医疗险"
              value={name}
            />
          </div>

          <SelectRow label="险种" onChange={setType} options={INSURANCE_TYPES} value={type} />

          <div className="transaction-form__card">
            <FieldRow
              label="保险公司"
              maxLength={80}
              onChange={(event) => setInsurer(event.target.value)}
              placeholder="如：平安保险"
              value={insurer}
            />
            <span className="transaction-form__divider" />
            <FieldRow
              label="保单号"
              maxLength={80}
              onChange={(event) => setPolicyNo(event.target.value)}
              placeholder="选填"
              value={policyNo}
            />
            <span className="transaction-form__divider" />
            <FieldRow
              label="投保方式"
              maxLength={40}
              onChange={(event) => setMethod(event.target.value)}
              placeholder="线上自助 / 代理人"
              value={method}
            />
            <span className="transaction-form__divider" />
            <FieldRow
              label="缴费方式"
              maxLength={40}
              onChange={(event) => setPaymentMethod(event.target.value)}
              placeholder="银行卡自动扣款 / 支付宝"
              value={paymentMethod}
            />
          </div>

          <MultiSelectRow
            emptyLabel="请先到人员管理添加"
            label="被保人"
            onToggle={toggleInsured}
            options={people.map((person) => ({ label: person.name, value: person.id }))}
            placeholder="选择被保人（可多选）"
            values={insuredIds}
          />

          <SelectRow
            label="缴费周期"
            onChange={setPremiumFreq}
            options={PREMIUM_FREQ_OPTIONS}
            value={premiumFreq}
          />

          <div className="transaction-form__card">
            <FieldRow
              inputMode="decimal"
              label="保额"
              onChange={(event) => setCoverage(event.target.value)}
              placeholder="0.00"
              prefix="¥"
              value={coverage}
            />
            <span className="transaction-form__divider" />
            <FieldRow
              inputMode="decimal"
              label={freqIsSingle ? "保费" : premiumFreq === "month" ? "每月保费" : "每年保费"}
              onChange={(event) => setPremium(event.target.value)}
              placeholder="0.00"
              prefix="¥"
              value={premium}
            />
            {!freqIsSingle ? (
              <>
                <span className="transaction-form__divider" />
                <FieldRow
                  inputMode="numeric"
                  label="缴费期数"
                  onChange={(event) => setPeriods(event.target.value)}
                  placeholder="选填，如 20"
                  value={periods}
                />
              </>
            ) : null}
          </div>

          {!freqIsSingle ? (
            <SelectRow
              label="续费"
              onChange={setRenewal}
              options={RENEWAL_OPTIONS}
              value={renewal}
            />
          ) : null}

          <div className="transaction-form__card">
            <DateFieldRow label="生效日" onChange={setStartDate} value={startDate} />
            <span className="transaction-form__divider" />
            <DateFieldRow label="到期日" onChange={setEndDate} value={endDate} />
          </div>

          <ReminderSchedulesEditor
            defaultLeadValue={DEFAULT_REMIND_LEAD_DAYS}
            enabled={remindEnabled}
            feishuEnabled={feishuEnabled}
            feishuLoading={feishuBindingsQuery.isLoading}
            feishuOptions={feishuTargetOptions}
            footer={
              endDate ? null : (
                <p className="px-1 text-xs text-[var(--color-text-muted)]">
                  需设置「到期日」后提醒才会生效。
                </p>
              )
            }
            hint="到期日前提醒续保或缴费，可设多档"
            onChange={setReminders}
            onEnabledChange={setRemindEnabled}
            value={reminders}
          />

          <AttachmentPicker
            accept="image/*,application/pdf,video/*,.doc,.docx,.xls,.xlsx"
            enabled={attachmentsEnabled}
            items={attachmentItems}
            onEnabledChange={setAttachmentsEnabled}
            onFilesSelected={addFiles}
            onOpen={openAttachment}
            onRemove={removeAttachment}
          />

          <LabeledCard label="保障内容">
            <textarea
              className="min-h-[76px] w-full resize-none bg-transparent text-[15px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
              onChange={(event) => setCoverageDesc(event.target.value)}
              placeholder="选填，如 一般医疗+重疾医疗，0免赔…"
              value={coverageDesc}
            />
          </LabeledCard>

          <LabeledCard label="备注">
            <textarea
              className="min-h-[52px] w-full resize-none bg-transparent text-[15px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
              maxLength={240}
              onChange={(event) => setNote(event.target.value)}
              placeholder="选填，如 含三者险 / 续保提醒…"
              value={note}
            />
          </LabeledCard>
        </div>
      </div>
    </form>
  );
}
