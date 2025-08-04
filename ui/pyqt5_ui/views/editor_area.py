from PyQt5.QtCore import Qt, QSize
from PyQt5.QtGui import QIcon, QTextCharFormat, QFont, QTextCursor
from PyQt5.QtWidgets import QTextEdit, QVBoxLayout, QWidget, QToolBar, QAction, QComboBox, QLabel, QFontComboBox, \
    QColorDialog


class RichTextEditor(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.editor = QTextEdit()
        self.toolbar = QToolBar("Formatting")
        self.font_family = QFontComboBox()
        self.font_size = QComboBox()
        self.setup_ui()
        
    def setup_ui(self):
        # Main layout
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        
        # Configure toolbar
        self.toolbar.setIconSize(QSize(16, 16))
        self.setup_toolbar()
        
        # Add widgets to layout
        layout.addWidget(self.toolbar)
        layout.addWidget(self.editor)
        
        self.setLayout(layout)
        
        # Set default font
        self.editor.setFontPointSize(12)
        
    def setup_toolbar(self):
        # Bold action
        bold_action = QAction(QIcon.fromTheme('format-text-bold'), 'Bold', self)
        bold_action.triggered.connect(self.toggle_bold)
        bold_action.setShortcut('Ctrl+B')
        self.toolbar.addAction(bold_action)
        
        # Italic action
        italic_action = QAction(QIcon.fromTheme('format-text-italic'), 'Italic', self)
        italic_action.triggered.connect(self.toggle_italic)
        italic_action.setShortcut('Ctrl+I')
        self.toolbar.addAction(italic_action)
        
        # Underline action
        underline_action = QAction(QIcon.fromTheme('format-text-underline'), 'Underline', self)
        underline_action.triggered.connect(self.toggle_underline)
        underline_action.setShortcut('Ctrl+U')
        self.toolbar.addAction(underline_action)
        
        self.toolbar.addSeparator()
        
        # Font size
        self.toolbar.addWidget(QLabel('Size: '))
        self.font_size.addItems([str(i) for i in range(8, 73, 2)])
        self.font_size.setCurrentText('12')
        self.font_size.currentTextChanged.connect(self.set_font_size)
        self.toolbar.addWidget(self.font_size)
        
        # Font family
        self.toolbar.addWidget(QLabel('Font: '))
        self.font_family.currentFontChanged.connect(self.set_font_family)
        self.toolbar.addWidget(self.font_family)
        
        self.toolbar.addSeparator()
        
        # Text color
        text_color = QAction(QIcon.fromTheme('format-text-color'), 'Text Color', self)
        text_color.triggered.connect(self.set_text_color)
        self.toolbar.addAction(text_color)
        
        # Background color
        bg_color = QAction(QIcon.fromTheme('format-fill-color'), 'Background Color', self)
        bg_color.triggered.connect(self.set_background_color)
        self.toolbar.addAction(bg_color)
        
        self.toolbar.addSeparator()
        
        # Alignment actions
        align_left = QAction(QIcon.fromTheme('format-justify-left'), 'Align Left', self)
        align_left.triggered.connect(lambda: self.set_alignment(Qt.AlignLeft))
        self.toolbar.addAction(align_left)
        
        align_center = QAction(QIcon.fromTheme('format-justify-center'), 'Center', self)
        align_center.triggered.connect(lambda: self.set_alignment(Qt.AlignCenter))
        self.toolbar.addAction(align_center)
        
        align_right = QAction(QIcon.fromTheme('format-justify-right'), 'Align Right', self)
        align_right.triggered.connect(lambda: self.set_alignment(Qt.AlignRight))
        self.toolbar.addAction(align_right)
        
        align_justify = QAction(QIcon.fromTheme('format-justify-fill'), 'Justify', self)
        align_justify.triggered.connect(lambda: self.set_alignment(Qt.AlignJustify))
        self.toolbar.addAction(align_justify)
    
    def toggle_bold(self):
        fmt = QTextCharFormat()
        fmt.setFontWeight(QFont.Bold if not self.editor.fontWeight() > QFont.Normal else QFont.Normal)
        self.merge_format_on_word_or_selection(fmt)
    
    def toggle_italic(self):
        fmt = QTextCharFormat()
        fmt.setFontItalic(not self.editor.fontItalic())
        self.merge_format_on_word_or_selection(fmt)
    
    def toggle_underline(self):
        fmt = QTextCharFormat()
        fmt.setFontUnderline(not self.editor.fontUnderline())
        self.merge_format_on_word_or_selection(fmt)
    
    def set_font_size(self, size):
        size = float(size)
        if size > 0:
            fmt = QTextCharFormat()
            fmt.setFontPointSize(size)
            self.merge_format_on_word_or_selection(fmt)
    
    def set_font_family(self, font):
        fmt = QTextCharFormat()
        fmt.setFontFamily(font.family())
        self.merge_format_on_word_or_selection(fmt)
    
    def set_text_color(self):
        color = QColorDialog.getColor(self.editor.textColor(), self)
        if color.isValid():
            fmt = QTextCharFormat()
            fmt.setForeground(color)
            self.merge_format_on_word_or_selection(fmt)
    
    def set_background_color(self):
        color = QColorDialog.getColor(self.editor.textBackgroundColor(), self)
        if color.isValid():
            fmt = QTextCharFormat()
            fmt.setBackground(color)
            self.merge_format_on_word_or_selection(fmt)
    
    def set_alignment(self, alignment):
        cursor = self.editor.textCursor()
        if not cursor.hasSelection():
            cursor.select(QTextCursor.LineUnderCursor)
        
        block_fmt = cursor.blockFormat()
        block_fmt.setAlignment(alignment)
        cursor.mergeBlockFormat(block_fmt)
        self.editor.setTextCursor(cursor)
    
    def merge_format_on_word_or_selection(self, format):
        cursor = self.editor.textCursor()
        if not cursor.hasSelection():
            cursor.select(QTextCursor.WordUnderCursor)
        cursor.mergeCharFormat(format)
        self.editor.mergeCurrentCharFormat(format)
    
    def toHtml(self):
        return self.editor.toHtml()
    
    def setHtml(self, html):
        self.editor.setHtml(html)
    
    def toPlainText(self):
        return self.editor.toPlainText()
    
    def setPlainText(self, text):
        self.editor.setPlainText(text)
    
    def clear(self):
        self.editor.clear()
