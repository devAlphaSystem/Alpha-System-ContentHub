document.addEventListener("DOMContentLoaded", () => {
  const refreshButton = document.getElementById("refresh-dashboard-btn");

  refreshButton?.addEventListener("click", () => {
    window.location.reload();
  });

  if (typeof dashboardMetrics !== "undefined" && dashboardMetrics && Object.keys(dashboardMetrics).length > 0) {
    const isDarkMode = document.body.classList.contains("dark-mode");
    const chartTheme = isDarkMode ? "dark" : "light";
    const gridColor = isDarkMode ? "#4b5563" : "#e0e0e0";
    const labelColor = isDarkMode ? "#e9ecef" : "#212529";
    const tooltipTheme = isDarkMode ? "dark" : "light";

    const typeChartColors = ["#188038", "#1967d2", "#862e9c"];
    const statusChartColors = ["#1e8e3e", "#5f6368", "#f9ab00"];

    const typeChartContainer = document.querySelector("#chart-global-types");
    const statusChartContainer = document.querySelector("#chart-global-status");
    const activityChartContainer = document.querySelector("#chart-global-activity");

    if (typeChartContainer) {
      const typeChartOptions = {
        chart: {
          type: "donut",
          height: 280,
          theme: {
            mode: chartTheme,
          },
        },
        series: [dashboardMetrics.documentationCount || 0, dashboardMetrics.changelogCount || 0],
        labels: ["Documentation", "Changelog"],
        colors: typeChartColors,
        dataLabels: {
          enabled: true,
          formatter: (val, opts) => opts.w.globals.series[opts.seriesIndex],
        },
        plotOptions: {
          pie: {
            donut: {
              size: "65%",
              labels: {
                show: true,
                total: {
                  show: true,
                  label: "Total Entries",
                  formatter: (w) =>
                    w.globals.seriesTotals.reduce((a, b) => {
                      return a + b;
                    }, 0),
                },
              },
            },
          },
        },
        legend: {
          position: "bottom",
          labels: {
            colors: labelColor,
          },
        },
        tooltip: {
          theme: tooltipTheme,
          y: {
            formatter: (value) => `${value} entries`,
          },
          marker: {
            show: true,
          },
          fixed: {
            enabled: false,
          },
          followCursor: false,
        },
        responsive: [
          {
            breakpoint: 480,
            options: {
              chart: {
                height: 240,
              },
              legend: {
                position: "bottom",
              },
            },
          },
        ],
      };
      const typeChart = new ApexCharts(typeChartContainer, typeChartOptions);
      typeChart.render();
    }

    if (statusChartContainer) {
      const statusChartOptions = {
        chart: {
          type: "donut",
          height: 280,
          theme: {
            mode: chartTheme,
          },
        },
        series: [dashboardMetrics.publishedCount || 0, dashboardMetrics.draftCount || 0, dashboardMetrics.stagedCount || 0],
        labels: ["Published", "Draft", "Staged Changes"],
        colors: statusChartColors,
        dataLabels: {
          enabled: true,
          formatter: (val, opts) => opts.w.globals.series[opts.seriesIndex],
        },
        plotOptions: {
          pie: {
            donut: {
              size: "65%",
              labels: {
                show: true,
                total: {
                  show: true,
                  label: "Total Entries",
                  formatter: (w) => {
                    return w.globals.seriesTotals.reduce((a, b) => {
                      return a + b;
                    }, 0);
                  },
                },
              },
            },
          },
        },
        legend: {
          position: "bottom",
          labels: {
            colors: labelColor,
          },
        },
        tooltip: {
          theme: tooltipTheme,
          y: {
            formatter: (value) => `${value} entries`,
          },
          marker: {
            show: true,
          },
          fixed: {
            enabled: false,
          },
          followCursor: false,
        },
        responsive: [
          {
            breakpoint: 480,
            options: {
              chart: {
                height: 240,
              },
              legend: {
                position: "bottom",
              },
            },
          },
        ],
      };
      const statusChart = new ApexCharts(statusChartContainer, statusChartOptions);
      statusChart.render();
    }

    if (activityChartContainer && dashboardMetrics.activityData && dashboardMetrics.activityData.length > 0) {
      const activityChartOptions = {
        chart: {
          height: 300,
          type: "area",
          zoom: {
            enabled: false,
          },
          toolbar: {
            show: false,
          },
          theme: {
            mode: chartTheme,
          },
        },
        series: [
          {
            name: "Entries Created",
            data: dashboardMetrics.activityData,
          },
        ],
        dataLabels: {
          enabled: false,
        },
        stroke: {
          curve: "smooth",
          width: 2,
        },
        xaxis: {
          type: "datetime",
          labels: {
            style: {
              colors: labelColor,
            },
            datetimeUTC: false,
          },
          tooltip: {
            enabled: false,
          },
        },
        yaxis: {
          title: {
            text: "Count",
            style: {
              color: labelColor,
            },
          },
          labels: {
            style: {
              colors: labelColor,
            },
            formatter: (val) => Number.parseInt(val),
          },
          min: 0,
          tickAmount: 4,
        },
        grid: {
          borderColor: gridColor,
          strokeDashArray: 4,
          yaxis: {
            lines: {
              show: true,
            },
          },
          xaxis: {
            lines: {
              show: false,
            },
          },
        },
        tooltip: {
          theme: tooltipTheme,
          x: {
            format: "dd MMM yyyy",
          },
        },
        fill: {
          type: "gradient",
          gradient: {
            shadeIntensity: 1,
            opacityFrom: 0.4,
            opacityTo: 0.1,
            stops: [0, 90, 100],
          },
        },
      };
      const activityChart = new ApexCharts(activityChartContainer, activityChartOptions);
      activityChart.render();
    } else if (activityChartContainer) {
      // Handled by EJS now
    } else {
      console.warn("Chart container #chart-global-activity not found.");
    }
  } else {
    console.warn("Global dashboard metrics data not found or empty.");
    const chartAreas = document.querySelectorAll("#chart-global-types, #chart-global-status, #chart-global-activity");
    for (const area of chartAreas) {
      if (area) {
        area.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-muted);">Metrics data unavailable.</p>';
      }
    }
  }
});
