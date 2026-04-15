//! Format terminal content as plain text, VT sequences, or HTML.
//!
//! A formatter captures a reference to a terminal and formatting options.
//! It can be used repeatedly to produce output that reflects the current
//! terminal state at the time of each format call.
use std::{marker::PhantomData, ptr::NonNull};

use crate::{
    alloc::{Allocator, Bytes, Object},
    error::{Error, Result, from_result},
    ffi,
    terminal::Terminal,
};

/// Formatter that formats terminal content.
#[derive(Debug)]
pub struct Formatter<'t, 'alloc: 'cb, 'cb: 't> {
    inner: Object<'alloc, ffi::FormatterImpl>,
    _terminal: PhantomData<&'t Terminal<'alloc, 'cb>>,
}

/// Options for creating a terminal formatter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FormatterOptions {
    /// Output format to emit.
    pub format: Format,
    /// Whether to trim trailing whitespace on non-blank lines.
    pub trim: bool,
    /// Whether to unwrap soft-wrapped lines.
    pub unwrap: bool,
    /// Extra terminal/screen state to include in the formatted output.
    pub extra: FormatterExtra,
}

/// Extra screen state to include in formatted output.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct FormatterScreenExtra {
    /// Emit cursor position using CUP (CSI H).
    pub cursor: bool,
    /// Emit current SGR style state based on the cursor's active style_id.
    pub style: bool,
    /// Emit current hyperlink state using OSC 8 sequences.
    pub hyperlink: bool,
    /// Emit character protection mode using DECSCA.
    pub protection: bool,
    /// Emit Kitty keyboard protocol state using CSI > u and CSI = sequences.
    pub kitty_keyboard: bool,
    /// Emit character set designations and invocations.
    pub charsets: bool,
}

/// Extra terminal state to include in formatted output.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct FormatterExtra {
    /// Emit the palette using OSC 4 sequences.
    pub palette: bool,
    /// Emit terminal modes that differ from their defaults using CSI h/l.
    pub modes: bool,
    /// Emit scrolling region state using DECSTBM and DECSLRM sequences.
    pub scrolling_region: bool,
    /// Emit tabstop positions by clearing all tabs and setting each one.
    pub tabstops: bool,
    /// Emit the present working directory using OSC 7.
    pub pwd: bool,
    /// Emit keyboard modes such as ModifyOtherKeys.
    pub keyboard: bool,
    /// Emit screen-level extras.
    pub screen: FormatterScreenExtra,
}

impl<'t, 'alloc: 'cb, 'cb: 't> Formatter<'t, 'alloc, 'cb> {
    /// Create a formatter for a terminal's active screen.
    pub fn new(terminal: &'t Terminal<'alloc, 'cb>, opts: FormatterOptions) -> Result<Self> {
        // SAFETY: A NULL allocator is always valid
        unsafe { Self::new_inner(std::ptr::null(), terminal, opts) }
    }

    /// Create a formatter for a terminal's active screen.
    ///
    /// See the [crate-level documentation](crate#memory-management-and-lifetimes)
    /// regarding custom memory management and lifetimes.
    pub fn new_with_alloc<'ctx: 'alloc, Ctx>(
        alloc: &'alloc Allocator<'ctx, Ctx>,
        terminal: &'t Terminal<'alloc, 'cb>,
        opts: FormatterOptions,
    ) -> Result<Self> {
        // SAFETY: Borrow checking should forbid invalid allocators
        unsafe { Self::new_inner(alloc.to_raw(), terminal, opts) }
    }

    unsafe fn new_inner(
        alloc: *const ffi::Allocator,
        terminal: &'t Terminal<'alloc, 'cb>,
        opts: FormatterOptions,
    ) -> Result<Self> {
        let mut raw: ffi::Formatter = std::ptr::null_mut();
        let result = unsafe {
            ffi::ghostty_formatter_terminal_new(
                alloc,
                &raw mut raw,
                terminal.inner.as_raw(),
                opts.into(),
            )
        };
        from_result(result)?;

        Ok(Self {
            inner: Object::new(raw)?,
            _terminal: PhantomData,
        })
    }

    /// Run the formatter and return an allocated buffer with the output.
    ///
    /// Each call formats the current terminal state. The buffer is allocated
    /// using the provided allocator (or the default allocator if `None`).
    pub fn format_alloc<'a, 'ctx: 'a, Ctx>(
        &mut self,
        alloc: Option<&'a Allocator<'ctx, Ctx>>,
    ) -> Result<Bytes<'a>> {
        let alloc = if let Some(alloc) = alloc {
            alloc.to_raw()
        } else {
            std::ptr::null()
        };

        let mut bytes = std::ptr::null_mut();
        let mut len = 0usize;
        let result = unsafe {
            ffi::ghostty_formatter_format_alloc(
                self.inner.as_raw(),
                alloc,
                std::ptr::from_mut(&mut bytes),
                std::ptr::from_mut(&mut len),
            )
        };
        from_result(result)?;

        let ptr = NonNull::new(bytes).ok_or(Error::OutOfMemory)?;
        Ok(unsafe { Bytes::from_raw_parts(ptr, len, alloc) })
    }

    /// Run the formatter and produce output into the caller-provided buffer.
    ///
    /// Each call formats the current terminal state. If the buffer is too small,
    /// returns `Err(Error::OutOfSpace { required })` where `required` is the
    /// required size. The caller can then retry with a larger buffer.
    pub fn format_buf(&mut self, buf: &mut [u8]) -> Result<usize> {
        let mut len = 0usize;
        let result = unsafe {
            ffi::ghostty_formatter_format_buf(
                self.inner.as_raw(),
                std::ptr::from_mut(buf).cast(),
                buf.len(),
                std::ptr::from_mut(&mut len),
            )
        };
        from_result(result)?;
        Ok(len)
    }

    /// Query the required buffer size for the formatted output.
    ///
    /// The result can be used to create a sufficiently large buffer
    /// for [`Formatter::format_buf`].
    pub fn format_len(&mut self) -> Result<usize> {
        let mut len = 0usize;
        let result = unsafe {
            ffi::ghostty_formatter_format_buf(
                self.inner.as_raw(),
                std::ptr::null_mut(),
                0,
                std::ptr::from_mut(&mut len),
            )
        };
        // This should always fail with OutOfSpace.
        match from_result(result) {
            Err(Error::OutOfSpace { .. }) => Ok(len),
            Err(e) => Err(e),
            Ok(()) => Err(Error::InvalidValue),
        }
    }
}

impl Drop for Formatter<'_, '_, '_> {
    fn drop(&mut self) {
        unsafe { ffi::ghostty_formatter_free(self.inner.as_raw()) }
    }
}

impl From<FormatterOptions> for ffi::FormatterTerminalOptions {
    fn from(value: FormatterOptions) -> Self {
        Self {
            size: std::mem::size_of::<ffi::FormatterTerminalOptions>(),
            emit: value.format.into(),
            trim: value.trim,
            extra: value.extra.into(),
            unwrap: value.unwrap,
        }
    }
}

impl From<FormatterExtra> for ffi::FormatterTerminalExtra {
    fn from(value: FormatterExtra) -> Self {
        Self {
            size: std::mem::size_of::<ffi::FormatterTerminalExtra>(),
            palette: value.palette,
            modes: value.modes,
            scrolling_region: value.scrolling_region,
            tabstops: value.tabstops,
            pwd: value.pwd,
            keyboard: value.keyboard,
            screen: value.screen.into(),
        }
    }
}

impl From<FormatterScreenExtra> for ffi::FormatterScreenExtra {
    fn from(value: FormatterScreenExtra) -> Self {
        Self {
            size: std::mem::size_of::<ffi::FormatterScreenExtra>(),
            cursor: value.cursor,
            style: value.style,
            hyperlink: value.hyperlink,
            protection: value.protection,
            kitty_keyboard: value.kitty_keyboard,
            charsets: value.charsets,
        }
    }
}

/// Output format.
#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, int_enum::IntEnum)]
pub enum Format {
    /// Plain text (no escape sequences).
    Plain = ffi::FormatterFormat::PLAIN,
    /// VT sequences preserving colors, styles, URLs, etc.
    Vt = ffi::FormatterFormat::VT,
    /// HTML with inline styles.
    Html = ffi::FormatterFormat::HTML,
}
