document.addEventListener("DOMContentLoaded", () => {
  if (typeof projectMetrics !== "undefined" && projectMetrics && Object.keys(projectMetrics).length > 0) {
    const isDarkMode = document.body.classList.contains("dark-mode");
    const chartTheme = isDarkMode ? "dark" : "light";
    const gridColor = isDarkMode ? "#4b5563" : "#e0e0e0";
    const labelColor = isDarkMode ? "#e9ecef" : "#212529";
    const tooltipTheme = isDarkMode ? "dark" : "light";

    const activityChartContainer = document.querySelector("#chart-activity");
    if (activityChartContainer && projectMetrics.activityData && projectMetrics.activityData.length > 0) {
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
            data: projectMetrics.activityData,
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
      // EJS handles the "no activity" message now
    } else {
      console.warn("Chart container #chart-activity not found.");
    }
  } else {
    console.warn("Project metrics data not found or empty.");
    const chartAreas = document.querySelectorAll("#chart-activity");
    for (const area of chartAreas) {
      if (area) {
        area.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-muted);">Metrics data unavailable.</p>';
      }
    }
  }
});
