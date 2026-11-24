import React from 'react';
import { act, create } from 'react-test-renderer';
import { Brand } from '../src/ui/kit';

describe('Fold wordmark', () => {
  it.each([13, 15, 17])('keeps the rendered artwork proportions at size %s', size => {
    let tree: ReturnType<typeof create>;
    act(() => { tree = create(<Brand size={size} />); });
    const image = tree!.root.findByProps({ accessibilityLabel: 'slopcoder' });
    expect(image.props.accessibilityRole).toBe('image');
    expect(image.props.style.width).toBe(size * 7.5);
    expect(image.props.style.aspectRatio).toBe(1957 / 427);
    expect(image.props.accessibilityIgnoresInvertColors).toBe(true);
    expect(image.props.resizeMode).toBe('contain');
  });
});
