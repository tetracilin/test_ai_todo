import React from 'react';
import { Icon } from './Icon';

export const LoaderIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={`${className} animate-spin`} strokeWidth="3">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </Icon>
);
