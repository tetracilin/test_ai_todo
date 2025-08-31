
import React from 'react';
import { Icon } from './Icon';

export const OnGoingIcon: React.FC<{ className?: string, title?: string }> = ({ className, title }) => (
  <Icon className={className} strokeWidth="2.5" fill="none" title={title}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </Icon>
);
