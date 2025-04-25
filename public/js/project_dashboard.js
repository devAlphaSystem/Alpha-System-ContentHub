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
      console.log("Activity chart container found, but no activity data.");
    } else {
      console.warn("Chart container #chart-activity not found.");
    }

    const feedbackChartContainer = document.querySelector("#chart-feedback");
    const helpfulYes = projectMetrics.helpfulYesCount || 0;
    const helpfulNo = projectMetrics.helpfulNoCount || 0;

    if (feedbackChartContainer && (helpfulYes > 0 || helpfulNo > 0)) {
      const feedbackChartOptions = {
        series: [helpfulYes, helpfulNo],
        chart: {
          type: "donut",
          height: 300,
          theme: {
            mode: chartTheme,
          },
        },
        labels: ["Helpful", "Not Helpful"],
        colors: ["#1e8e3e", "#d93025"],
        legend: {
          position: "bottom",
          labels: {
            colors: labelColor,
          },
        },
        tooltip: {
          theme: tooltipTheme,
          y: {
            formatter: (val) => `${val} votes`,
          },
        },
        dataLabels: {
          enabled: true,
          formatter: (val, opts) => {
            const seriesTotal = opts.w.globals.seriesTotals.reduce((a, b) => a + b, 0);
            if (seriesTotal === 0) {
              return "0%";
            }
            const percentage = Math.round((opts.w.globals.series[opts.seriesIndex] / seriesTotal) * 100);
            return `${percentage}%`;
          },
          style: {
            colors: ["#fff"],
          },
          dropShadow: {
            enabled: true,
            top: 1,
            left: 1,
            blur: 1,
            opacity: 0.45,
          },
        },
        responsive: [
          {
            breakpoint: 480,
            options: {
              chart: {
                width: "100%",
              },
              legend: {
                position: "bottom",
              },
            },
          },
        ],
      };

      const feedbackChart = new ApexCharts(feedbackChartContainer, feedbackChartOptions);
      feedbackChart.render();
    } else if (feedbackChartContainer) {
      console.log("Feedback chart container found, but no feedback data.");
    } else {
      console.warn("Chart container #chart-feedback not found.");
    }
  } else {
    console.warn("Project metrics data not found or empty.");
    const chartAreas = document.querySelectorAll("#chart-activity, #chart-feedback");
    for (const area of chartAreas) {
      if (area) {
        area.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-muted);">Metrics data unavailable.</p>';
      }
    }
  }
});
