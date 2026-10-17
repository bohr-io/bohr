import { defineComponent, h, useId } from 'vue';

/** v1's icon gradient (yellow, orange, red), top to bottom. */
export const ICON_GRADIENT_STOPS = [
  ['0%', '#F4CD3B'],
  ['50%', '#F16622'],
  ['100%', '#E84856'],
] as const;

export interface IconDefinition {
  viewBox: string;
  paths: readonly string[];
  /** Default rendered width in pixels; height follows the viewBox ratio. */
  size?: number;
}

export const iconProps = {
  size: { type: Number, default: undefined },
  /** Fill color; defaults to currentColor. */
  color: { type: String, default: undefined },
  /** Fill with the bohr fire gradient. */
  gradient: { type: Boolean, default: false },
  /** Accessible name. Without it the icon is decorative and hidden from assistive technology. */
  title: { type: String, default: undefined },
} as const;

export function createIcon(name: string, definition: IconDefinition) {
  const [, , viewBoxWidth = 24, viewBoxHeight = 24] = definition.viewBox.split(/\s+/).map(Number);
  const ratio = viewBoxHeight / viewBoxWidth;

  return defineComponent({
    name,
    props: iconProps,
    setup(props) {
      // useId keeps gradient ids stable between SSR and hydration.
      const gradientId = `bohr-icon-${useId()}`;

      return () => {
        const width = props.size ?? definition.size ?? viewBoxWidth;
        const fill = props.gradient ? `url(#${gradientId})` : (props.color ?? 'currentColor');

        return h(
          'svg',
          {
            xmlns: 'http://www.w3.org/2000/svg',
            width,
            height: Math.round(width * ratio * 100) / 100,
            viewBox: definition.viewBox,
            fill: 'none',
            focusable: 'false',
            role: props.title ? 'img' : undefined,
            'aria-hidden': props.title ? undefined : 'true',
          },
          [
            props.title ? h('title', props.title) : null,
            props.gradient
              ? h('defs', [
                  h(
                    'linearGradient',
                    { id: gradientId, x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
                    ICON_GRADIENT_STOPS.map(([offset, color]) => h('stop', { offset, 'stop-color': color })),
                  ),
                ])
              : null,
            ...definition.paths.map((d) => h('path', { d, fill, 'fill-rule': 'evenodd', 'clip-rule': 'evenodd' })),
          ],
        );
      };
    },
  });
}
