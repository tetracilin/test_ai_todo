
import React from 'react';
import { Icon } from './Icon';

export const RssIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className}>
    <path d="M4 11a9 9 0 0 1 9 9" />
    <path d="M4 4a16 16 0 0 1 16 16" />
    <circle cx="5" cy="19" r="1" />
  </Icon>
);
