import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentChoiceMenu } from './AttachmentChoiceMenu'

afterEach(cleanup)

describe('AttachmentChoiceMenu', () => {
  it('shows the file name and both choices', () => {
    render(<AttachmentChoiceMenu x={0} y={0} fileName="report.pdf" onChoose={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('“report.pdf”')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Attach as file' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Embed in note' })).toBeInTheDocument()
  })

  it('clicking "Attach as file" calls onChoose with "file" and closes', () => {
    const onChoose = vi.fn()
    const onClose = vi.fn()
    render(<AttachmentChoiceMenu x={0} y={0} fileName="report.pdf" onChoose={onChoose} onClose={onClose} />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Attach as file' }))

    expect(onChoose).toHaveBeenCalledWith('file')
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking "Embed in note" calls onChoose with "embed" and closes', () => {
    const onChoose = vi.fn()
    const onClose = vi.fn()
    render(<AttachmentChoiceMenu x={0} y={0} fileName="report.pdf" onChoose={onChoose} onClose={onClose} />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Embed in note' }))

    expect(onChoose).toHaveBeenCalledWith('embed')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<AttachmentChoiceMenu x={0} y={0} fileName="report.pdf" onChoose={vi.fn()} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on an outside click', () => {
    const onClose = vi.fn()
    render(<AttachmentChoiceMenu x={0} y={0} fileName="report.pdf" onChoose={vi.fn()} onClose={onClose} />)

    fireEvent.pointerDown(document.body)

    expect(onClose).toHaveBeenCalled()
  })
})
