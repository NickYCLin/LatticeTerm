/**
 * The model picker: a list when the CLI can name its models, a free text
 * field when it cannot. Either way an empty value means "the CLI's default".
 */

import { useEffect } from "react";
import type { ChatDefinitionId, ChatModelList } from "../../app/agentChat";
import { useI18n } from "../../i18n/context";

export function ModelField({
  definitionId,
  value,
  disabled,
  title,
  models,
  loadModels,
  onChange,
}: {
  definitionId: ChatDefinitionId;
  value: string;
  disabled?: boolean;
  title?: string;
  models: Record<ChatDefinitionId, ChatModelList>;
  loadModels: (definitionId: ChatDefinitionId) => void;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const list = models[definitionId];

  useEffect(() => {
    loadModels(definitionId);
  }, [definitionId, loadModels]);

  if (list.state === "ready") {
    // A value the list does not know (typed earlier, or from another
    // machine) stays selectable rather than silently becoming the default.
    const known = list.models.some((model) => model.value === value);
    return (
      <label className="field">
        <span className="field__label">{t("chat.model")}</span>
        <select
          className="select"
          value={value}
          disabled={disabled}
          title={title}
          onChange={(event) => onChange(event.target.value)}
        >
          {!list.models.some((model) => model.value === "") && (
            <option value="">{t("chat.model.default")}</option>
          )}
          {list.models.map((model) => (
            <option key={model.value || "default"} value={model.value}>
              {model.label}
              {model.description ? ` — ${model.description}` : ""}
            </option>
          ))}
          {!known && value && <option value={value}>{value}</option>}
        </select>
      </label>
    );
  }

  return (
    <label className="field">
      <span className="field__label">{t("chat.model")}</span>
      <input
        className="input"
        value={value}
        disabled={disabled}
        title={title}
        placeholder={list.state === "loading" ? t("chat.model.loading") : t("chat.model.placeholder")}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
