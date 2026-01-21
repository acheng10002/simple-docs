import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PasswordCriteria, { validatePassword } from '../../src/components/PasswordCriteria';

describe('validatePassword', () => {
  it('should return false for empty password', () => {
    expect(validatePassword('')).toBe(false);
  });

  it('should return false for password shorter than 8 characters', () => {
    expect(validatePassword('Abc1!')).toBe(false);
  });

  it('should return false for password without uppercase letter', () => {
    expect(validatePassword('abcdefg1!')).toBe(false);
  });

  it('should return false for password without lowercase letter', () => {
    expect(validatePassword('ABCDEFG1!')).toBe(false);
  });

  it('should return false for password without number', () => {
    expect(validatePassword('Abcdefgh!')).toBe(false);
  });

  it('should return false for password without special character', () => {
    expect(validatePassword('Abcdefg1')).toBe(false);
  });

  it('should return true for valid password meeting all criteria', () => {
    expect(validatePassword('Abcdefg1!')).toBe(true);
  });

  it('should return true for password with various special characters', () => {
    expect(validatePassword('Password1@')).toBe(true);
    expect(validatePassword('Password1#')).toBe(true);
    expect(validatePassword('Password1$')).toBe(true);
    expect(validatePassword('Password1%')).toBe(true);
    expect(validatePassword('Password1^')).toBe(true);
    expect(validatePassword('Password1&')).toBe(true);
    expect(validatePassword('Password1*')).toBe(true);
    expect(validatePassword('Password1(')).toBe(true);
    expect(validatePassword('Password1)')).toBe(true);
    expect(validatePassword('Password1,')).toBe(true);
    expect(validatePassword('Password1.')).toBe(true);
    expect(validatePassword('Password1?')).toBe(true);
    expect(validatePassword('Password1"')).toBe(true);
    expect(validatePassword('Password1:')).toBe(true);
    expect(validatePassword('Password1{')).toBe(true);
    expect(validatePassword('Password1}')).toBe(true);
    expect(validatePassword('Password1|')).toBe(true);
    expect(validatePassword('Password1<')).toBe(true);
    expect(validatePassword('Password1>')).toBe(true);
  });

  it('should return true for long complex password', () => {
    expect(validatePassword('MyV3ryStr0ng!P@ssword')).toBe(true);
  });
});

describe('PasswordCriteria component', () => {
  it('should render all 5 criteria', () => {
    render(<PasswordCriteria password="" />);

    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('At least one uppercase letter')).toBeInTheDocument();
    expect(screen.getByText('At least one lowercase letter')).toBeInTheDocument();
    expect(screen.getByText('At least one number')).toBeInTheDocument();
    expect(screen.getByText('At least one special character')).toBeInTheDocument();
  });

  it('should show check icon when length criterion is met', () => {
    render(<PasswordCriteria password="abcdefgh" />);

    const lengthCriterion = screen.getByText('At least 8 characters');
    expect(lengthCriterion.closest('div')?.querySelector('[data-testid="CheckIcon"]')).toBeInTheDocument();
  });

  it('should show close icon when criterion is not met', () => {
    render(<PasswordCriteria password="" />);

    const lengthCriterion = screen.getByText('At least 8 characters');
    expect(lengthCriterion.closest('div')?.querySelector('[data-testid="CloseIcon"]')).toBeInTheDocument();
  });

  it('should show all criteria met for valid password', () => {
    render(<PasswordCriteria password="Password1!" />);

    const checkIcons = document.querySelectorAll('[data-testid="CheckIcon"]');
    expect(checkIcons.length).toBe(5);
  });

  it('should show partial criteria met', () => {
    render(<PasswordCriteria password="abc" />);

    const checkIcons = document.querySelectorAll('[data-testid="CheckIcon"]');
    const closeIcons = document.querySelectorAll('[data-testid="CloseIcon"]');

    // Only lowercase should be met
    expect(checkIcons.length).toBe(1);
    expect(closeIcons.length).toBe(4);
  });
});
