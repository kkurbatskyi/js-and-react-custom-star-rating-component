// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StarRating } from './StarRating';

afterEach(cleanup);

const radios = () => screen.getAllByRole('radio');

function Harness({ initial = 0, onChange }: { initial?: number; onChange?: (v: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <StarRating
      label="Kiranth"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('StarRating — interactive', () => {
  it('is a radio group of five labelled stars', () => {
    render(<Harness initial={4} />);
    expect(screen.getByRole('radiogroup', { name: 'Your rating for Kiranth' })).toBeTruthy();
    expect(radios()).toHaveLength(5);
    expect(screen.getByRole('radio', { name: 'Rate Kiranth 4 of 5 stars' })).toBeTruthy();
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
      'true',
      'false',
    ]);
  });

  it('uses a roving tabindex: the chosen star, or the first when unrated', () => {
    const { unmount } = render(<Harness />);
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    unmount();
    render(<Harness initial={3} />);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1, -1]);
  });

  it('chooses a star on click and clears when the same star is clicked again', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(radios()[2]!);
    expect(onChange).toHaveBeenLastCalledWith(3);
    expect(radios()[2]!.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radios()[2]!);
    expect(onChange).toHaveBeenLastCalledWith(0);
    expect(radios().every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
  });

  it('moves and chooses with the arrow keys, clamped to 1..5', () => {
    const onChange = vi.fn();
    render(<Harness initial={2} onChange={onChange} />);
    const stars = radios();
    stars[1]!.focus();
    fireEvent.keyDown(stars[1]!, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(3);
    expect(document.activeElement).toBe(radios()[2]);
    fireEvent.keyDown(radios()[2]!, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(radios()[1]!, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(1);
    onChange.mockClear();
    fireEvent.keyDown(radios()[0]!, { key: 'ArrowLeft' }); // already at the floor
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(radios()[0]!, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(radios()[4]!, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('accepts digits, and Backspace/Delete/0 clear', () => {
    const onChange = vi.fn();
    render(<Harness initial={2} onChange={onChange} />);
    fireEvent.keyDown(radios()[1]!, { key: '4' });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(radios()[3]!, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith(0);
    onChange.mockClear();
    fireEvent.keyDown(radios()[0]!, { key: 'Delete' }); // nothing to clear
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(radios()[0]!, { key: '9' }); // out of range
    expect(onChange).not.toHaveBeenCalled();
  });

  it('previews on mouse hover (not touch) and reports it', () => {
    const onPreview = vi.fn();
    const { container } = render(
      <StarRating label="Kiranth" value={2} onChange={() => undefined} onPreview={onPreview} />,
    );
    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerOver(radios()[3]!, { pointerType: 'mouse' });
    expect(root.dataset.preview).toBe('4');
    expect(onPreview).toHaveBeenLastCalledWith(4);
    expect(radios().map((r) => r.getAttribute('data-fill'))).toEqual(['1', '1', '1', '1', '0']);
    fireEvent.pointerOut(radios()[3]!, { pointerType: 'mouse' });
    fireEvent.pointerLeave(screen.getByRole('radiogroup'));
    expect(root.dataset.preview).toBeUndefined();
    expect(onPreview).toHaveBeenLastCalledWith(0);
    fireEvent.pointerOver(radios()[4]!, { pointerType: 'touch' });
    expect(root.dataset.preview).toBeUndefined();
  });

  it('lights the supernova only when a fifth star is newly chosen', () => {
    const { container } = render(<Harness initial={4} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('is-nova')).toBe(false);
    fireEvent.click(radios()[4]!);
    expect(root.classList.contains('is-nova')).toBe(true);
    expect(container.querySelector('.sd-nova')).not.toBeNull();
  });

  it('is not interactive without onChange', () => {
    render(<StarRating label="Kiranth" value={3} />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});

describe('StarRating — read-only', () => {
  it('speaks the value and renders halves', () => {
    const { container } = render(
      <StarRating label="Halcyon" value={3.5} readOnly caption="Surveyor's rating" showValue />,
    );
    expect(
      screen.getByRole('img', { name: "Surveyor's rating for Halcyon: 3.5 of 5 stars" }),
    ).toBeTruthy();
    const fills = [...container.querySelectorAll('.sd-star')].map((s) => s.getAttribute('data-fill'));
    expect(fills).toEqual(['1', '1', '1', '0.5', '0']);
    expect(container.textContent).toContain('3.5');
  });

  it('rounds to the nearest half and clamps', () => {
    render(<StarRating label="X" value={4.3} readOnly />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('4.5 of 5');
    cleanup();
    render(<StarRating label="X" value={9} readOnly />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('5 of 5');
    cleanup();
    render(<StarRating label="X" value={0} readOnly />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('none of 5');
  });
});
