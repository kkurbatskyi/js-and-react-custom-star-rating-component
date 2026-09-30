// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../state/store';
import { halcyon, resetStore } from '../testing';
import { CopyLinkButton } from './CopyLinkButton';

beforeEach(resetStore);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CopyLinkButton', () => {
  it('copies the deep link and confirms with a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<CopyLinkButton id={halcyon.id} name="Halcyon" />);
    fireEvent.click(screen.getByRole('button', { name: /Copy link/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Copied/ })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`#${halcyon.id.replaceAll('.', '\\.')}$`)),
    );
    expect(store.getState().toasts.at(-1)).toMatchObject({ text: 'Link copied', tone: 'success' });
  });

  it('shows the link pre-selected when the host blocks the clipboard (no alert)', async () => {
    vi.stubGlobal('navigator', {});
    document.execCommand = vi.fn().mockReturnValue(false);
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    render(<CopyLinkButton id={halcyon.id} name="Halcyon" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy link/ }));
    });
    const field = await screen.findByRole('textbox', { name: /Link to Halcyon/ });
    expect((field as HTMLInputElement).value.endsWith(`#${halcyon.id}`)).toBe(true);
    expect((field as HTMLInputElement).readOnly).toBe(true);
    expect(alert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /Copy link/ })).toBeTruthy();
  });
});
