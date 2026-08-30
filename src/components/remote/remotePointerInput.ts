export interface RemotePointerButtonChange {
  button: number;
  pressed: boolean;
}

export interface RemotePointerTransition {
  accepted: boolean;
  buttonChanges: RemotePointerButtonChange[];
  releaseAll: boolean;
}

const BUTTON_BITS = [
  { bit: 1, button: 0 },
  { bit: 2, button: 2 },
  { bit: 4, button: 1 },
  { bit: 8, button: 3 },
  { bit: 16, button: 4 },
] as const;

function buttonChanges(
  previous: number,
  next: number,
): RemotePointerButtonChange[] {
  return BUTTON_BITS.flatMap(({ bit, button }) =>
    (previous & bit) === (next & bit)
      ? []
      : [{ button, pressed: (next & bit) !== 0 }],
  );
}

/**
 * Tracks the one pointer that owns the remote cursor and synchronises the
 * complete `buttons` bitmask. Pointer Events do not emit another pointerdown
 * when a mouse chord adds a second button, so move transitions must carry
 * those button changes too.
 */
export class RemotePointerInputState {
  activePointerId: number | null = null;
  private buttons = 0;

  begin(
    pointerId: number,
    isPrimary: boolean,
    buttons: number,
  ): RemotePointerTransition {
    if (!isPrimary || this.activePointerId !== null) return this.rejected();
    this.activePointerId = pointerId;
    return this.syncButtons(buttons);
  }

  move(
    pointerId: number,
    isPrimary: boolean,
    buttons: number,
  ): RemotePointerTransition {
    if (
      !isPrimary ||
      (this.activePointerId !== null && this.activePointerId !== pointerId)
    ) {
      return this.rejected();
    }
    // Hover still moves the cursor, but a button held before entering the
    // canvas was never pressed remotely and must not be invented here.
    return this.activePointerId === null
      ? this.accepted()
      : this.syncButtons(buttons);
  }

  end(
    pointerId: number,
    isPrimary: boolean,
    buttons: number,
  ): RemotePointerTransition {
    if (!isPrimary || this.activePointerId !== pointerId) return this.rejected();
    const transition = this.syncButtons(buttons);
    this.activePointerId = null;
    return transition;
  }

  cancel(pointerId: number, isPrimary: boolean): RemotePointerTransition {
    if (!isPrimary || this.activePointerId !== pointerId) return this.rejected();
    this.activePointerId = null;
    this.buttons = 0;
    return { accepted: true, buttonChanges: [], releaseAll: true };
  }

  reset(): void {
    this.activePointerId = null;
    this.buttons = 0;
  }

  private syncButtons(next: number): RemotePointerTransition {
    const bounded = next & 0x1f;
    const changes = buttonChanges(this.buttons, bounded);
    this.buttons = bounded;
    return { accepted: true, buttonChanges: changes, releaseAll: false };
  }

  private accepted(): RemotePointerTransition {
    return { accepted: true, buttonChanges: [], releaseAll: false };
  }

  private rejected(): RemotePointerTransition {
    return { accepted: false, buttonChanges: [], releaseAll: false };
  }
}
