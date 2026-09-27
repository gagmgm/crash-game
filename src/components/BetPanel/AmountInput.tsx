import { useState } from 'react';
import { gameConfig } from '../../config/gameConfig';
import type { BetLimits } from '../../types/bet';
import {
  clampMinor,
  minorToDecimalString,
  parseMoneyInput,
  type MinorUnits,
} from '../../utils/money';
import styles from './BetPanel.module.css';

interface Props {
  amount: MinorUnits;
  currency: string;
  limits: BetLimits;
  balance: MinorUnits | null;
  disabled: boolean;
  onChange(amount: MinorUnits): void;
}

export function AmountInput({ amount, currency, limits, balance, disabled, onChange }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (value: MinorUnits) => clampMinor(value, limits.min, limits.max);

  let hint = '';
  if (draft !== null && parseMoneyInput(draft) === null) hint = 'Enter a valid amount';
  else if (amount < limits.min) hint = `Minimum bet is ${minorToDecimalString(limits.min)}`;
  else if (amount > limits.max) hint = `Maximum bet is ${minorToDecimalString(limits.max)}`;
  else if (balance !== null && amount > balance) hint = 'Amount exceeds your balance';

  return (
    <div className={styles.section}>
      <label className={styles.label} htmlFor="bet-amount">
        BET AMOUNT
      </label>
      <div className={styles.inputRow}>
        <input
          id="bet-amount"
          className={styles.input}
          inputMode="decimal"
          autoComplete="off"
          value={draft ?? minorToDecimalString(amount)}
          disabled={disabled}
          onFocus={(e) => {
            setDraft(minorToDecimalString(amount));
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            const parsed = parseMoneyInput(e.target.value);
            if (parsed !== null) onChange(parsed);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span className={styles.currency}>{currency}</span>
      </div>
      <div className={styles.quick}>
        {gameConfig.bet.quickAdd.map((add) => (
          <button
            key={add}
            type="button"
            disabled={disabled}
            onClick={() => onChange(clamp(amount + add))}
          >
            +{minorToDecimalString(add).replace(/\.00$/, '')}
          </button>
        ))}
        <button type="button" disabled={disabled} onClick={() => onChange(clamp(amount / 2))}>
          ½
        </button>
        <button type="button" disabled={disabled} onClick={() => onChange(clamp(amount * 2))}>
          x2
        </button>
      </div>
      <div className={styles.hint} role="status">
        {disabled ? '' : hint}
      </div>
    </div>
  );
}
