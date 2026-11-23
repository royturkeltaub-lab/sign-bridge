// Plays sign plans on the avatar, one after another, and keeps the caption in sync.
import { Avatar } from '../render/avatar.js';
import { buildTimeline, sampleTimeline } from '../render/timeline.js';
import { localLandmarks } from '../core/handModel.js';
import { REST } from '../signs/space.js';

const restHand = (state) => ({ ...state, local: localLandmarks(state.shape) });
const REST_POSE = { dom: restHand(REST.dom), non: restHand(REST.non), item: -1, letter: -1 };

export class SignPlayer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} caption
   */
  constructor(canvas, caption) {
    this.avatar = new Avatar(canvas);
    this.upgrade(canvas);
    this.caption = caption;
    this.queue = [];
    this.current = null; // { timeline, elapsed, dir }
    this.last = null;
    this.speed = 1;
    this.lastTick = performance.now();
    this.shown = { item: -2, letter: -2 };
    const tick = (now) => {
      this.frame(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * Swap the drawn avatar for the 3D character once its model has loaded. The drawn one
   * stays as the fallback where WebGL or the model is unavailable.
   */
  async upgrade(canvas) {
    try {
      const { Avatar3D, CHARACTERS } = await import('../render/avatar3d.js');
      // ?avatar=classic picks the other bundled character.
      const character = CHARACTERS[new URLSearchParams(location.search).get('avatar')] || CHARACTERS.casual;
      const canvas3d = Object.assign(document.createElement('canvas'), { id: 'avatar3d' });
      canvas3d.hidden = true;
      canvas.after(canvas3d);
      const avatar = await Avatar3D.create(canvas3d, character);
      canvas.hidden = true;
      canvas3d.hidden = false;
      this.avatar = avatar;
    } catch (err) {
      console.warn('3D avatar unavailable, keeping the drawn avatar', err);
      document.getElementById('avatar3d')?.remove();
    }
  }

  /** Queue a plan. `dir` is the caption's text direction ('ltr' | 'rtl'). */
  play(plan, dir = 'ltr') {
    if (!plan.length) return;
    // Keep the avatar close to live speech: drop backlog beyond a couple of sentences.
    if (this.queue.length > 2) this.queue.shift();
    this.queue.push({ plan, dir });
  }

  replay() {
    if (this.last && !this.current) this.queue.push(this.last);
  }

  clear() {
    this.queue = [];
    this.current = null;
  }

  frame(now) {
    const dt = Math.min(100, now - this.lastTick);
    this.lastTick = now;
    if (!this.current && this.queue.length) {
      const next = this.queue.shift();
      this.current = { ...next, timeline: buildTimeline(next.plan), elapsed: 0 };
      this.last = next;
      this.renderCaption();
    }
    if (!this.current) {
      this.avatar.draw(REST_POSE);
      return;
    }
    this.current.elapsed += dt * this.speed;
    const pose = sampleTimeline(this.current.timeline, this.current.elapsed);
    this.avatar.draw(pose);
    this.highlight(pose.item, pose.letter);
    if (this.current.elapsed >= this.current.timeline.duration) this.current = null;
  }

  renderCaption() {
    const { plan, dir } = this.current;
    this.caption.dir = dir;
    this.caption.replaceChildren(
      ...plan.map((item) => {
        const chip = document.createElement('span');
        chip.className = `chip ${item.type}`;
        if (item.type === 'sign') {
          chip.textContent = item.gloss;
        } else {
          chip.title = 'Fingerspelled';
          for (const letter of item.letters) {
            const span = document.createElement('span');
            span.textContent = letter.ch;
            chip.append(span);
          }
        }
        return chip;
      }),
    );
    this.shown = { item: -2, letter: -2 };
  }

  highlight(item, letter) {
    if (item === this.shown.item && letter === this.shown.letter) return;
    this.shown = { item, letter };
    [...this.caption.children].forEach((chip, i) => {
      chip.classList.toggle('active', i === item);
      [...chip.children].forEach((span, li) => span.classList.toggle('ltr-on', i === item && li === letter));
    });
  }
}
