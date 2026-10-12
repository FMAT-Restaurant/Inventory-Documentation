const path = require('node:path');

const siteUrl = 'https://fmat-restaurant.github.io';
const baseUrl = '/Inventory-Documentation/';
const repositoryUrl = 'https://github.com/FMAT-Restaurant/Inventory-Documentation';

module.exports = {
  title: 'Inventory Service',
  url: siteUrl,
  baseUrl,
  trailingSlash: true,
  organizationName: 'FMAT-Restaurant',
  projectName: 'Inventory-Documentation',
  // Kept lenient while the specification is still being consolidated.
  onBrokenLinks: 'warn',
  onBrokenAnchors: 'warn',
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],
  presets: [
    [
      'classic',
      {
        docs: {
          path: path.resolve('./docs'),
          routeBasePath: '/',
          sidebarPath: path.resolve('./sidebars.js'),
        },
        blog: false,
      },
    ],
  ],
  plugins: [
    function disableOptionalMermaidElk() {
      return {
        name: 'disable-optional-mermaid-elk',
        configureWebpack() {
          return {
            resolve: {
              alias: {
                '@mermaid-js/layout-elk$': false,
              },
            },
          };
        },
      };
    },
    [
      '@scalar/docusaurus',
      {
        label: 'API Reference',
        route: '/api/',
        showNavLink: false,
        configuration: {
          url: `${baseUrl}api/openapi.yaml`,
          hideTestRequestButton: true,
        },
      },
    ],
  ],
  themeConfig: {
    colorMode: {
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    mermaid: {
      theme: {
        light: 'neutral',
        dark: 'dark',
      },
      options: {
        layout: 'dagre',
      },
    },
    navbar: {
      title: 'Inventory Service',
      // Docusaurus prefixes these internal routes with baseUrl.
      items: [
        {
          to: '/requisitos/',
          label: 'Documentation',
          position: 'left',
        },
        {
          to: '/mockups/',
          label: 'Mockups',
          position: 'left',
        },
        {
          to: '/api/',
          label: 'API Reference',
          position: 'left',
        },
        {
          href: repositoryUrl,
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
  },
};
