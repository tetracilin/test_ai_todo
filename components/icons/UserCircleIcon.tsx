import React from 'react';
import { Icon } from './Icon';

export const UserCircleIcon: React.FC<{ className?: string, title?: string }> = ({ className, title }) => (
  <Icon className={className} title={title}>
    <circle cx="12" cy="12" r="10"></circle>
    <circle cx="12" cy="10" r="3"></circle>
    <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"></path>
  </Icon>
);