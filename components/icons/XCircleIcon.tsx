
import React from 'react';
import { Icon } from './Icon';

export const XCircleIcon: React.FC<{ className?: string, title?: string }> = ({ className, title }) => (
  <Icon className={className} title={title}>
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="15" y1="9" x2="9" y2="15"></line>
    <line x1="9" y1="9" x2="15" y2="15"></line>
  </Icon>
);
