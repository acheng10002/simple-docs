import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PasswordField from '../../src/components/PasswordField';

describe('PasswordField', () => {
  it('renders as a password input by default', () => {
    render(<PasswordField label="Password" />);

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('toggles to text input when visibility button is clicked', () => {
    render(<PasswordField label="Password" />);

    const input = screen.getByLabelText('Password');
    const toggleButton = screen.getByLabelText('toggle password visibility');

    fireEvent.click(toggleButton);
    expect(input).toHaveAttribute('type', 'text');
  });

  it('toggles back to password input on second click', () => {
    render(<PasswordField label="Password" />);

    const input = screen.getByLabelText('Password');
    const toggleButton = screen.getByLabelText('toggle password visibility');

    fireEvent.click(toggleButton);
    fireEvent.click(toggleButton);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('passes additional props to the underlying TextField', () => {
    render(
      <PasswordField
        label="Password"
        required
        error
        helperText="Required field"
      />
    );

    expect(screen.getByText('Required field')).toBeInTheDocument();
    expect(screen.getByLabelText('Password *')).toBeRequired();
  });
});
