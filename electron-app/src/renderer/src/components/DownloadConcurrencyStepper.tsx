import { useState, type ReactElement } from 'react'
import { MAX_CONCURRENT_IMAGE_DOWNLOADS } from '../../../shared/settings-constraints'

export function DownloadConcurrencyStepper({
  value,
  inputLabel,
  decreaseLabel,
  increaseLabel,
  onChange
}: {
  value: number
  inputLabel: string
  decreaseLabel: string
  increaseLabel: string
  onChange: (value: number) => void
}): ReactElement {
  const [draft, setDraft] = useState(String(value))

  const changeValue = (nextValue: number): void => {
    setDraft(String(nextValue))
    onChange(nextValue)
  }

  const applyDraft = (nextDraft: string): void => {
    setDraft(nextDraft)
    const count = Number(nextDraft)
    if (
      nextDraft !== '' &&
      Number.isInteger(count) &&
      count >= 1 &&
      count <= MAX_CONCURRENT_IMAGE_DOWNLOADS
    ) {
      onChange(count)
    }
  }

  const restoreValue = (): void => {
    const count = Number(draft)
    if (
      draft !== '' &&
      Number.isInteger(count) &&
      count >= 1 &&
      count <= MAX_CONCURRENT_IMAGE_DOWNLOADS
    ) {
      changeValue(count)
      setDraft(String(count))
    } else {
      setDraft(String(value))
    }
  }

  return (
    <div className="download-stepper">
      <button
        type="button"
        aria-label={decreaseLabel}
        onClick={() => changeValue(Math.max(1, value - 1))}
        disabled={value <= 1}
      >
        −
      </button>
      <input
        id="max-concurrent-image-downloads"
        type="number"
        min="1"
        max={MAX_CONCURRENT_IMAGE_DOWNLOADS}
        step="1"
        aria-label={inputLabel}
        value={draft}
        onChange={(event) => applyDraft(event.currentTarget.value)}
        onBlur={restoreValue}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <button
        type="button"
        aria-label={increaseLabel}
        onClick={() => changeValue(Math.min(MAX_CONCURRENT_IMAGE_DOWNLOADS, value + 1))}
        disabled={value >= MAX_CONCURRENT_IMAGE_DOWNLOADS}
      >
        +
      </button>
    </div>
  )
}
