// MediaPipe's handedness label, as the signer's own hand ('left' | 'right').
// Checked on a raw (unmirrored) photo with both hands visible: the labels matched the
// person's actual hands, and agreed with the geometric test in features.js (chirality).
// The label is only a tie-breaker: features.js decides from the landmarks whenever it can.
export function signerHand(label) {
  return String(label || 'Right').toLowerCase().startsWith('l') ? 'left' : 'right';
}
