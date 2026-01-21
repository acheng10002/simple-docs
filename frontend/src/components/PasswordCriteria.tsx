import React from 'react';
import { Box, Typography } from '@mui/material';
import { Check as CheckIcon, Close as CloseIcon } from '@mui/icons-material';

interface PasswordCriteriaProps {
  password: string;
}

interface Criterion {
  label: string;
  test: (password: string) => boolean;
}

const criteria: Criterion[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'At least one uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'At least one lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'At least one number', test: (p) => /[0-9]/.test(p) },
  { label: 'At least one special character', test: (p) => /[!@#$%^&*(),.?":{}|<>]/.test(p) },
];

export function validatePassword(password: string): boolean {
  return criteria.every((criterion) => criterion.test(password));
}

export default function PasswordCriteria({ password }: PasswordCriteriaProps) {
  return (
    <Box sx={{ mt: 1, mb: 1 }}>
      {criteria.map((criterion, index) => {
        const isMet = criterion.test(password);
        return (
          <Box
            key={index}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              mb: 0.5,
            }}
          >
            {isMet ? (
              <CheckIcon data-testid="CheckIcon" sx={{ fontSize: 16, color: 'success.main' }} />
            ) : (
              <CloseIcon data-testid="CloseIcon" sx={{ fontSize: 16, color: 'error.main' }} />
            )}
            <Typography
              variant="caption"
              sx={{ color: isMet ? 'success.main' : 'error.main' }}
            >
              {criterion.label}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
