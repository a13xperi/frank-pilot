import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  AppShell,
  Sidebar,
  TopBar,
  BottomBar,
  TwoPane,
  FormGrid,
  DataTable,
  Card,
  CTA,
  Pill,
  ListRow,
} from '..';

describe('BP-00 primitives smoke', () => {
  describe('AppShell', () => {
    it('renders mobile variant', () => {
      render(<AppShell variant="mobile">main</AppShell>);
      expect(screen.getByText('main')).toBeInTheDocument();
    });
    it('renders desktop variant with sidebar + top + bottom', () => {
      render(
        <AppShell
          variant="desktop"
          topBar={<div>top</div>}
          sidebar={<div>side</div>}
          bottomBar={<div>bot</div>}
        >
          main
        </AppShell>,
      );
      expect(screen.getByText('top')).toBeInTheDocument();
      expect(screen.getByText('side')).toBeInTheDocument();
      expect(screen.getByText('main')).toBeInTheDocument();
    });
  });

  describe('Sidebar', () => {
    it('renders mobile', () => {
      render(<Sidebar variant="mobile">nav-m</Sidebar>);
      expect(screen.getByText('nav-m')).toBeInTheDocument();
    });
    it('renders desktop', () => {
      render(<Sidebar variant="desktop">nav-d</Sidebar>);
      expect(screen.getByText('nav-d')).toBeInTheDocument();
    });
  });

  describe('TopBar', () => {
    it('renders both variants', () => {
      render(<TopBar variant="mobile">m</TopBar>);
      render(<TopBar variant="desktop">d</TopBar>);
      expect(screen.getByText('m')).toBeInTheDocument();
      expect(screen.getByText('d')).toBeInTheDocument();
    });
  });

  describe('BottomBar', () => {
    it('renders both variants', () => {
      render(<BottomBar variant="mobile">bm</BottomBar>);
      render(<BottomBar variant="desktop">bd</BottomBar>);
      expect(screen.getByText('bm')).toBeInTheDocument();
      expect(screen.getByText('bd')).toBeInTheDocument();
    });
  });

  describe('TwoPane', () => {
    it('renders mobile + desktop', () => {
      render(<TwoPane variant="mobile" left={<div>L1</div>} right={<div>R1</div>} />);
      render(<TwoPane variant="desktop" left={<div>L2</div>} right={<div>R2</div>} />);
      expect(screen.getByText('L1')).toBeInTheDocument();
      expect(screen.getByText('R2')).toBeInTheDocument();
    });
  });

  describe('FormGrid', () => {
    it('renders both variants', () => {
      render(
        <FormGrid variant="mobile">
          <div>fm</div>
        </FormGrid>,
      );
      render(
        <FormGrid variant="desktop" columns={2}>
          <div>fd</div>
        </FormGrid>,
      );
      expect(screen.getByText('fm')).toBeInTheDocument();
      expect(screen.getByText('fd')).toBeInTheDocument();
    });
  });

  describe('DataTable', () => {
    type Row = { id: number; name: string };
    const rows: Row[] = [{ id: 1, name: 'Alice' }];
    const cols = [
      { key: 'id', header: 'ID', render: (r: Row) => String(r.id) },
      { key: 'name', header: 'Name', render: (r: Row) => r.name },
    ];
    it('renders mobile', () => {
      render(
        <DataTable
          variant="mobile"
          rows={rows}
          columns={cols}
          rowKey={(r) => r.id}
        />,
      );
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    it('renders desktop', () => {
      render(
        <DataTable
          variant="desktop"
          rows={rows}
          columns={cols}
          rowKey={(r) => r.id}
        />,
      );
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    it('renders empty', () => {
      render(
        <DataTable
          variant="desktop"
          rows={[]}
          columns={cols}
          rowKey={(r) => r.id}
          empty="nope"
        />,
      );
      expect(screen.getByText('nope')).toBeInTheDocument();
    });
  });

  describe('Card', () => {
    it('renders both variants', () => {
      render(<Card variant="mobile">cm</Card>);
      render(<Card variant="desktop">cd</Card>);
      expect(screen.getByText('cm')).toBeInTheDocument();
      expect(screen.getByText('cd')).toBeInTheDocument();
    });
  });

  describe('CTA', () => {
    it('renders both variants', () => {
      render(<CTA variant="mobile">go-m</CTA>);
      render(<CTA variant="desktop" tone="sage">go-d</CTA>);
      expect(screen.getByRole('button', { name: 'go-m' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'go-d' })).toBeInTheDocument();
    });
  });

  describe('Pill', () => {
    it('renders both variants', () => {
      render(<Pill variant="mobile" tone="accent">pm</Pill>);
      render(<Pill variant="desktop" tone="ok">pd</Pill>);
      expect(screen.getByText('pm')).toBeInTheDocument();
      expect(screen.getByText('pd')).toBeInTheDocument();
    });
  });

  describe('ListRow', () => {
    it('renders both variants', () => {
      render(<ListRow variant="mobile" title="rm" subtitle="sub" />);
      render(<ListRow variant="desktop" title="rd" />);
      expect(screen.getByText('rm')).toBeInTheDocument();
      expect(screen.getByText('rd')).toBeInTheDocument();
    });
  });
});
