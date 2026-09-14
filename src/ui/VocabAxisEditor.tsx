/**
 * One closed-vocabulary axis: tick values for the cross product, double-click to
 * rename a term, or 新建 to append. Edits persist via the session vocab overlay.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Input, Stack, Typography } from '@aviala-design/spiral';
import { validateVocabTerm } from '../paradigm/vocab-term';
import type { Axis, AxisSelection } from './types';

const axisLabel = (axis: Axis) => axis.labelZh || axis.label;

type VocabTermProps = {
  value: string;
  active: boolean;
  onToggle: () => void;
  onRename: (next: string) => string | null;
};

function VocabTerm({ value, active, onToggle, onRename }: VocabTermProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    },
    []
  );

  const commit = () => {
    const result = validateVocabTerm(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.value === value) {
      setEditing(false);
      setError(null);
      return;
    }
    const renameError = onRename(result.value);
    if (renameError) {
      setError(renameError);
      return;
    }
    setEditing(false);
    setError(null);
  };

  if (editing) {
    return (
      <Stack gap="inside" direction="column">
        <Input
          ref={inputRef}
          size="regular"
          fullWidth={false}
          allRound
          value={draft}
          aria-label={`编辑词 ${value}`}
          error={!!error}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(value);
              setError(null);
              setEditing(false);
            }
          }}
          onBlur={commit}
        />
        {error ? (
          <Typography level="caption" className="vc-vocab-error">
            {error}
          </Typography>
        ) : null}
      </Stack>
    );
  }

  return (
    <Button
      mode={active ? 'second' : 'outline'}
      size="tiny"
      allRound
      aria-pressed={active}
      title="单击勾选；双击编辑"
      onClick={() => {
        if (clickTimer.current) clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          onToggle();
        }, 220);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        if (clickTimer.current) {
          clearTimeout(clickTimer.current);
          clickTimer.current = null;
        }
        setDraft(value);
        setError(null);
        setEditing(true);
      }}
    >
      {value}
    </Button>
  );
}

type VocabAxisEditorProps = {
  axis: Axis;
  selected: string[];
  onToggleValue: (value: string) => void;
  onReplaceValues: (values: string[], remap?: { from: string; to: string }) => void;
};

export function VocabAxisEditor({
  axis,
  selected,
  onToggleValue,
  onReplaceValues
}: VocabAxisEditorProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const commitCreate = () => {
    if (!creating) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft('');
      setError(null);
      setCreating(false);
      return;
    }
    const result = validateVocabTerm(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (axis.values.includes(result.value)) {
      setError('该词已存在于本轴');
      return;
    }
    onReplaceValues([...axis.values, result.value]);
    setDraft('');
    setError(null);
    setCreating(false);
  };

  return (
    <Stack gap="inside" direction="column">
      <div className="vc-row vc-row--tight">
        <Typography level="caption" title={axis.note}>
          {axisLabel(axis)}
        </Typography>
        <Typography level="caption" className="vc-push" content="number">
          {selected.length} / {axis.values.length}
        </Typography>
      </div>
      <div className="vc-row vc-row--tight">
        {axis.values.map((value) => (
          <VocabTerm
            key={value}
            value={value}
            active={selected.includes(value)}
            onToggle={() => onToggleValue(value)}
            onRename={(next) => {
              if (axis.values.includes(next)) return '该词已存在于本轴';
              onReplaceValues(
                axis.values.map((candidate) => (candidate === value ? next : candidate)),
                { from: value, to: next }
              );
              return null;
            }}
          />
        ))}
        {creating ? (
          <Stack gap="inside" direction="column">
            <Input
              ref={inputRef}
              size="regular"
              fullWidth={false}
              allRound
              value={draft}
              placeholder="新词 camelCase"
              aria-label={`新建 ${axisLabel(axis)} 词`}
              error={!!error}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitCreate();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraft('');
                  setError(null);
                  setCreating(false);
                }
              }}
              onBlur={commitCreate}
            />
            {error ? (
              <Typography level="caption" className="vc-vocab-error">
                {error}
              </Typography>
            ) : null}
          </Stack>
        ) : (
          <Button
            mode="noBackground"
            size="tiny"
            onClick={() => {
              setDraft('');
              setError(null);
              setCreating(true);
            }}
          >
            新建
          </Button>
        )}
      </div>
    </Stack>
  );
}

/** Helpers the axes step uses when a term is renamed while ticked. */
export const remapAxisSelection = (
  selection: AxisSelection,
  slot: string,
  remap?: { from: string; to: string }
): AxisSelection => {
  if (!remap) return selection;
  const list = selection.axes[slot] ?? [];
  return {
    ...selection,
    axes: {
      ...selection.axes,
      [slot]: list.map((value) => (value === remap.from ? remap.to : value))
    }
  };
};
