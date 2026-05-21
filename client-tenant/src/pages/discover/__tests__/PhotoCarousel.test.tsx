// @vitest-environment jsdom
// Tests assume vitest + @testing-library/react + jsdom. Lane A's test wiring
// will install these; until then this file is documented intent.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PhotoCarousel } from '../PhotoCarousel';

const photos = [
  'https://example.com/a.jpg',
  'https://example.com/b.jpg',
  'https://example.com/c.jpg',
];

describe('PhotoCarousel', () => {
  it('renders counter starting at 1 / N', () => {
    render(<PhotoCarousel photos={photos} alt="Test" />);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('advances index when next arrow clicked', () => {
    render(<PhotoCarousel photos={photos} alt="Test" />);
    fireEvent.click(screen.getByTestId('carousel-next'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('advances index when right arrow key pressed', () => {
    render(<PhotoCarousel photos={photos} alt="Test" />);
    const region = screen.getByTestId('photo-carousel');
    region.focus();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('retreats index when left arrow key pressed', () => {
    render(<PhotoCarousel photos={photos} alt="Test" />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    // wraps to last
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
  });

  it('advances index on left-swipe (touchstart → touchend with dx < -50)', () => {
    render(<PhotoCarousel photos={photos} alt="Test" />);
    const region = screen.getByTestId('photo-carousel');
    const surface = region.querySelector('div')!; // touch handlers on inner div
    fireEvent.touchStart(surface, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 100 }] });
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('ignores swipe below threshold', () => {
    render(<PhotoCarousel photos={photos} alt="Test" />);
    const region = screen.getByTestId('photo-carousel');
    const surface = region.querySelector('div')!;
    fireEvent.touchStart(surface, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 180 }] });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
});
