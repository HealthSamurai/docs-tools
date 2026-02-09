/**
 * OG Image template using satori-compatible JSX.
 * Satori uses its own JSX runtime (React-like), not our custom one.
 * We define the template as plain objects (satori VNode format).
 */

export interface OgTemplateOptions {
  title: string;
  brand: string;
  color: string;
  description?: string;
}

/**
 * Build the OG image markup as a satori-compatible VNode.
 * 1200x630 pixels, standard OG image size.
 */
export function ogTemplate(options: OgTemplateOptions) {
  const { title, brand, color, description } = options;

  // Truncate title if too long
  const displayTitle =
    title.length > 80 ? title.slice(0, 77) + "..." : title;

  return {
    type: "div",
    props: {
      style: {
        width: "1200px",
        height: "630px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "60px 80px",
        backgroundColor: "#ffffff",
        fontFamily: "Inter, sans-serif",
      },
      children: [
        // Top: brand + accent bar
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "16px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    width: "8px",
                    height: "40px",
                    backgroundColor: color,
                    borderRadius: "4px",
                  },
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "28px",
                    fontWeight: 600,
                    color: "#666666",
                    letterSpacing: "-0.5px",
                  },
                  children: brand,
                },
              },
            ],
          },
        },
        // Middle: title
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              flex: 1,
              justifyContent: "center",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: title.length > 50 ? "42px" : "52px",
                    fontWeight: 700,
                    color: "#1a1a1a",
                    lineHeight: 1.2,
                    letterSpacing: "-1px",
                  },
                  children: displayTitle,
                },
              },
              ...(description
                ? [
                    {
                      type: "div",
                      props: {
                        style: {
                          fontSize: "24px",
                          color: "#666666",
                          lineHeight: 1.4,
                        },
                        children:
                          description.length > 120
                            ? description.slice(0, 117) + "..."
                            : description,
                      },
                    },
                  ]
                : []),
            ],
          },
        },
        // Bottom: footer bar
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTop: "2px solid #ebebeb",
              paddingTop: "24px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "20px",
                    color: "#999999",
                  },
                  children: "Health Samurai",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "20px",
                    color: color,
                    fontWeight: 600,
                  },
                  children: "Documentation",
                },
              },
            ],
          },
        },
      ],
    },
  };
}
