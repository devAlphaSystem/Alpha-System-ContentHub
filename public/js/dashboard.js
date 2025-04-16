document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = document.getElementById("refresh-dashboard-btn");

  refreshBtn?.addEventListener("click", () => {
    window.location.reload();
  });

  if (typeof dashboardMetrics !== "undefined" && dashboardMetrics && Object.keys(dashboardMetrics).length > 0) {
    const isDarkMode = document.body.classList.contains("dark-mode");
    const chartTheme = isDarkMode ? "dark" : "light";
    const gridColor = isDarkMode ? "#4b5563" : "#e0e0e0";
    const labelColor = isDarkMode ? "#e9ecef" : "#212529";
    const tooltipTheme = isDarkMode ? "dark" : "light";
    const docColor = isDarkMode ? "var(--dark-badge-docs-text)" : "var(--badge-docs-text)";
    const clColor = isDarkMode ? "var(--dark-badge-changelog-text)" : "var(--badge-changelog-text)";
    const publishedColor = isDarkMode ? "var(--dark-success-color)" : "var(--success-color)";
    const draftColor = isDarkMode ? "var(--dark-secondary-color)" : "var(--secondary-color)";
    const stagedColor = isDarkMode ? "var(--dark-warning-color)" : "var(--warning-color)";

    const typesChartContainer = document.querySelector("#chart-global-types");
    if (typesChartContainer) {
      const typesChartOptions = {
        chart: { type: "donut", height: 280, theme: { mode: chartTheme } },
        series: [dashboardMetrics.documentationCount || 0, dashboardMetrics.changelogCount || 0],
        labels: ["Documentation", "Changelog"],
        colors: [docColor, clColor],
        dataLabels: {
          enabled: true,
          formatter: (val, opts) => opts.w.globals.series[opts.seriesIndex],
          style: { fontSize: "14px", fontWeight: "bold" },
          dropShadow: { enabled: false },
        },
        plotOptions: {
          pie: {
            donut: {
              size: "65%",
              labels: {
                show: true,
                name: { show: true },
                value: {
                  show: true,
                  formatter: (val) => Number.parseInt(val),
                },
                total: {
                  show: true,
                  label: "Total Entries",
                  formatter: (w) => dashboardMetrics.totalEntries || 0,
                },
              },
            },
          },
        },
        legend: {
          show: true,
          position: "bottom",
          labels: { colors: labelColor },
        },
        tooltip: {
          theme: tooltipTheme,
          y: {
            formatter: (val) => `${Number.parseInt(val)} entries`,
          },
        },
      };
      const typesChart = new ApexCharts(typesChartContainer, typesChartOptions);
      typesChart.render();
    } else {
      console.warn("Chart container #chart-global-types not found.");
    }

    const statusChartContainer = document.querySelector("#chart-global-status");
    const published = Number(dashboardMetrics.publishedCount) || 0;
    const draft = Number(dashboardMetrics.draftCount) || 0;
    const staged = Number(dashboardMetrics.stagedCount) || 0;

    const purelyPublished = published - staged;

    if (statusChartContainer && (purelyPublished > 0 || draft > 0 || staged > 0)) {
      const statusChartOptions = {
        chart: { type: "donut", height: 280, theme: { mode: chartTheme } },
        series: [purelyPublished, draft, staged],
        labels: ["Published", "Draft", "Staged Changes"],
        colors: [publishedColor, draftColor, stagedColor],
        dataLabels: {
          enabled: true,
          formatter: (val, opts) => opts.w.globals.series[opts.seriesIndex],
          style: { fontSize: "14px", fontWeight: "bold" },
          dropShadow: { enabled: false },
        },
        plotOptions: {
          pie: {
            donut: {
              size: "65%",
              labels: {
                show: true,
                name: { show: true },
                value: {
                  show: true,
                  formatter: (val) => Number.parseInt(val),
                },
                total: {
                  show: true,
                  label: "Total Entries",
                  formatter: (w) => dashboardMetrics.totalEntries || 0,
                },
              },
            },
          },
        },
        legend: {
          show: true,
          position: "bottom",
          labels: { colors: labelColor },
        },
        tooltip: {
          theme: tooltipTheme,
          y: {
            formatter: (val, { seriesIndex, w }) => {
              const label = w.globals.labels[seriesIndex];
              return `${Number.parseInt(val)} ${label}`;
            },
          },
        },
      };
      const statusChart = new ApexCharts(statusChartContainer, statusChartOptions);
      statusChart.render();
    } else if (statusChartContainer) {
      statusChartContainer.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-muted);">No entries found to display status.</p>';
    } else {
      console.warn("Chart container #chart-global-status not found.");
    }

    const activityChartContainer = document.querySelector("#chart-global-activity");
    if (activityChartContainer && dashboardMetrics.activityData && dashboardMetrics.activityData.length > 0) {
      const activityChartOptions = {
        chart: {
          height: 300,
          type: "area",
          zoom: { enabled: false },
          toolbar: { show: false },
          theme: { mode: chartTheme },
        },
        series: [
          {
            name: "Entries Created",
            data: dashboardMetrics.activityData,
          },
        ],
        dataLabels: { enabled: false },
        stroke: { curve: "smooth", width: 2 },
        xaxis: {
          type: "datetime",
          labels: {
            style: { colors: labelColor },
            datetimeUTC: false,
          },
          tooltip: { enabled: false },
        },
        yaxis: {
          title: { text: "Count", style: { color: labelColor } },
          labels: {
            style: { colors: labelColor },
            formatter: (val) => Number.parseInt(val),
          },
          min: 0,
          tickAmount: 4,
        },
        grid: {
          borderColor: gridColor,
          strokeDashArray: 4,
          yaxis: { lines: { show: true } },
          xaxis: { lines: { show: false } },
        },
        tooltip: {
          theme: tooltipTheme,
          x: { format: "dd MMM yyyy" },
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
      // EJS handles the "no activity" message now
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
